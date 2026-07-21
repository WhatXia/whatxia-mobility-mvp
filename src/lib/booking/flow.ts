import type { IncomingMessage, UserSession, UserState } from "@/types";
import type {
  BookingDraft,
  PlaceCandidate,
  ResolvedPlace,
} from "@/lib/geo/types";
import {
  isHighConfidenceMatch,
  topCandidates,
} from "@/lib/geo/confidence";
import { candidateToResolved, reverseGeocode } from "@/lib/geo/geocoding";
import { mapsUrlForCoords, mapsUrlForPlaceId } from "@/lib/geo/maps-url";
import { searchPlaces } from "@/lib/geo/places";
import { estimateRoute } from "@/lib/geo/routes";
import { GoogleMapsError } from "@/lib/geo/client";
import { calculateFare, formatFareCop } from "@/lib/pricing/engine";
import { offerTripToDrivers } from "@/lib/dispatch";
import { clearSession, upsertSession } from "@/lib/sessions";
import {
  sendButtonsMessage,
  sendLocationMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";

export const BOOKING_BUTTON_IDS = {
  CONFIRM_PLACE: "booking_confirm_place",
  REJECT_PLACE: "booking_reject_place",
  SHARE_HINT: "booking_share_hint",
  REQUEST_TRIP: "booking_request_trip",
  CANCEL_QUOTE: "booking_cancel_quote",
  CANDIDATE_PREFIX: "booking_cand:",
} as const;

const BOOKING_STATES: UserState[] = [
  "WAITING_PICKUP_TEXT",
  "WAITING_PICKUP_CONFIRM",
  "WAITING_DROPOFF_TEXT",
  "WAITING_DROPOFF_CONFIRM",
  "WAITING_QUOTE_CONFIRM",
  // legacy
  "WAITING_PICKUP",
];

export function isBookingState(state: UserState | undefined): boolean {
  return Boolean(state && BOOKING_STATES.includes(state));
}

function placeLabel(place: ResolvedPlace): string {
  return place.name || place.address || "Ubicación";
}

async function sendPlaceForConfirm(
  phone: string,
  place: ResolvedPlace,
): Promise<void> {
  await sendLocationMessage(phone, {
    latitude: place.location.lat,
    longitude: place.location.lng,
    name: place.name,
    address: place.address,
  });

  const mapsLink = place.placeId
    ? mapsUrlForPlaceId(place.placeId, place.name)
    : mapsUrlForCoords(place.location);

  await sendButtonsMessage(
    phone,
    [
      `📍 ${placeLabel(place)}`,
      place.address ? place.address : null,
      "",
      `Mapa: ${mapsLink}`,
      "",
      "¿Es este el lugar correcto?",
    ]
      .filter((line) => line !== null)
      .join("\n"),
    [
      { id: BOOKING_BUTTON_IDS.CONFIRM_PLACE, title: "✅ Confirmar" },
      { id: BOOKING_BUTTON_IDS.REJECT_PLACE, title: "No es este" },
      { id: BOOKING_BUTTON_IDS.SHARE_HINT, title: "📍 Mi ubicación" },
    ],
  );
}

async function sendCandidateList(
  phone: string,
  candidates: PlaceCandidate[],
): Promise<void> {
  const top = topCandidates(candidates, 3);
  const lines = [
    "Encontramos varias opciones. Elige una:",
    "",
    ...top.map((c, i) => `${i + 1}. ${c.name}${c.address ? ` — ${c.address}` : ""}`),
  ];

  await sendButtonsMessage(
    phone,
    lines.join("\n").slice(0, 1024),
    top.map((c, i) => ({
      id: `${BOOKING_BUTTON_IDS.CANDIDATE_PREFIX}${i}`,
      title: `${i + 1}. ${c.name}`.slice(0, 20),
    })),
  );
}

async function persistDraft(
  phone: string,
  name: string,
  state: UserState,
  draft: BookingDraft,
  pickupNeighborhood?: string | null,
): Promise<void> {
  await upsertSession(phone, {
    name,
    state,
    bookingDraft: draft,
    pickupNeighborhood:
      pickupNeighborhood !== undefined
        ? pickupNeighborhood
        : draft.pickup
          ? placeLabel(draft.pickup)
          : null,
  });
}

export async function startBookingFlow(
  phone: string,
  name: string,
): Promise<void> {
  await upsertSession(phone, {
    name,
    state: "WAITING_PICKUP_TEXT",
    pickupNeighborhood: null,
    bookingDraft: {},
    driverName: null,
  });

  await sendTextMessage(phone, "¿Dónde te recogemos?");
}

async function resolveTextToPlace(
  phone: string,
  name: string,
  text: string,
  role: "pickup" | "dropoff",
  session: UserSession,
): Promise<void> {
  const draft: BookingDraft = { ...(session.bookingDraft ?? {}) };

  let candidates: PlaceCandidate[];
  try {
    candidates = await searchPlaces(text);
  } catch (error) {
    console.error("[booking] Places error:", error);
    await sendTextMessage(
      phone,
      "No pudimos buscar el lugar ahora. Intenta de nuevo en un momento.",
    );
    return;
  }

  if (candidates.length === 0) {
    await sendTextMessage(
      phone,
      "No encontramos ese lugar. Escribe una dirección o punto de referencia más claro.",
    );
    return;
  }

  draft.candidates = candidates;
  draft.candidateRole = role;

  if (isHighConfidenceMatch(candidates)) {
    const resolved = candidateToResolved(candidates[0]);
    if (role === "pickup") {
      draft.pickup = resolved;
      await persistDraft(phone, name, "WAITING_PICKUP_CONFIRM", draft);
    } else {
      draft.dropoff = resolved;
      await persistDraft(phone, name, "WAITING_DROPOFF_CONFIRM", draft);
    }
    await sendPlaceForConfirm(phone, resolved);
    return;
  }

  const confirmState =
    role === "pickup" ? "WAITING_PICKUP_CONFIRM" : "WAITING_DROPOFF_CONFIRM";
  await persistDraft(phone, name, confirmState, draft);
  await sendCandidateList(phone, candidates);
}

async function buildAndSendQuote(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  if (!draft.pickup || !draft.dropoff) {
    await sendTextMessage(
      phone,
      "Falta origen o destino. Escribe Hola para reiniciar.",
    );
    return;
  }

  // Idempotencia: reusar quote si ya existe para el mismo par.
  let route = draft.route;
  let quote = draft.quote;

  if (!route || !quote) {
    try {
      route = await estimateRoute(
        draft.pickup.location,
        draft.dropoff.location,
      );
      quote = calculateFare(route);
    } catch (error) {
      console.error("[booking] Routes/pricing error:", error);
      await sendTextMessage(
        phone,
        "No pudimos calcular la ruta. Revisa origen/destino o intenta luego.",
      );
      return;
    }
  }

  const nextDraft: BookingDraft = {
    ...draft,
    route,
    quote,
    candidates: undefined,
    candidateRole: undefined,
  };

  await persistDraft(phone, name, "WAITING_QUOTE_CONFIRM", nextDraft);

  const body = [
    "Resumen del servicio",
    "",
    `📍 Origen: ${placeLabel(draft.pickup)}`,
    `🎯 Destino: ${placeLabel(draft.dropoff)}`,
    `🛣️ Distancia: ${quote.distanceKm.toFixed(1)} km`,
    `⏱️ Tiempo estimado: ${quote.durationMin} min`,
    `💰 Tarifa aproximada: ${formatFareCop(quote.amount)}`,
    "",
    "¿Confirmas el servicio?",
  ].join("\n");

  await sendButtonsMessage(phone, body, [
    { id: BOOKING_BUTTON_IDS.REQUEST_TRIP, title: "✅ Solicitar" },
    { id: BOOKING_BUTTON_IDS.CANCEL_QUOTE, title: "❌ Cancelar" },
  ]);
}

async function afterPlaceConfirmed(
  phone: string,
  name: string,
  draft: BookingDraft,
  role: "pickup" | "dropoff",
): Promise<void> {
  if (role === "pickup") {
    await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", {
      ...draft,
      candidates: undefined,
      candidateRole: undefined,
      route: undefined,
      quote: undefined,
    });
    await sendTextMessage(phone, "¿Cuál es tu destino?");
    return;
  }

  await buildAndSendQuote(phone, name, {
    ...draft,
    candidates: undefined,
    candidateRole: undefined,
  });
}

/**
 * Maneja mensajes del flujo de cotización geográfica.
 * @returns true si el mensaje fue consumido por el booking flow.
 */
export async function handleBookingMessage(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isBookingState(session.state)) {
    return false;
  }

  const phone = message.phone;
  const name = message.name || session.name;
  const draft: BookingDraft = { ...(session.bookingDraft ?? {}) };

  // --- Quote confirm ---
  if (session.state === "WAITING_QUOTE_CONFIRM") {
    if (message.button === BOOKING_BUTTON_IDS.CANCEL_QUOTE) {
      await clearSession(phone);
      await sendTextMessage(phone, "Operación cancelada.");
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.REQUEST_TRIP) {
      if (!draft.pickup || !draft.dropoff || !draft.route || !draft.quote) {
        await sendTextMessage(
          phone,
          "La cotización expiró. Escribe Hola para solicitar de nuevo.",
        );
        await clearSession(phone);
        return true;
      }

      await upsertSession(phone, {
        name,
        state: "SEARCHING_DRIVER",
        pickupNeighborhood: placeLabel(draft.pickup),
        bookingDraft: draft,
      });

      await sendTextMessage(
        phone,
        "Estamos buscando un conductor. Un momento por favor.",
      );

      await offerTripToDrivers(phone, placeLabel(draft.pickup), {
        pickup: draft.pickup,
        dropoff: draft.dropoff,
        route: draft.route,
        quote: draft.quote,
      });
      return true;
    }

    await sendTextMessage(
      phone,
      "Usa los botones para Solicitar o Cancelar el servicio.",
    );
    return true;
  }

  // --- Shared location ---
  if (message.location) {
    const role: "pickup" | "dropoff" =
      session.state === "WAITING_DROPOFF_TEXT" ||
      session.state === "WAITING_DROPOFF_CONFIRM"
        ? "dropoff"
        : "pickup";

    let resolved: ResolvedPlace;
    try {
      resolved = await reverseGeocode({
        lat: message.location.lat,
        lng: message.location.lng,
      });
    } catch (error) {
      console.error("[booking] reverse geocode:", error);
      if (error instanceof GoogleMapsError) {
        await sendTextMessage(
          phone,
          "No pudimos interpretar tu ubicación. Intenta de nuevo o escribe el lugar.",
        );
        return true;
      }
      throw error;
    }

    if (role === "pickup") {
      draft.pickup = resolved;
      draft.route = undefined;
      draft.quote = undefined;
      await persistDraft(phone, name, "WAITING_PICKUP_CONFIRM", draft);
    } else {
      draft.dropoff = resolved;
      draft.route = undefined;
      draft.quote = undefined;
      await persistDraft(phone, name, "WAITING_DROPOFF_CONFIRM", draft);
    }
    await sendPlaceForConfirm(phone, resolved);
    return true;
  }

  // --- Confirm / reject / share hint / candidates ---
  if (
    session.state === "WAITING_PICKUP_CONFIRM" ||
    session.state === "WAITING_DROPOFF_CONFIRM"
  ) {
    const role: "pickup" | "dropoff" =
      session.state === "WAITING_PICKUP_CONFIRM" ? "pickup" : "dropoff";

    if (message.button === BOOKING_BUTTON_IDS.SHARE_HINT) {
      await sendTextMessage(
        phone,
        "Comparte tu ubicación con el clip 📎 → Ubicación en WhatsApp.",
      );
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.REJECT_PLACE) {
      const nextState =
        role === "pickup" ? "WAITING_PICKUP_TEXT" : "WAITING_DROPOFF_TEXT";
      if (role === "pickup") {
        draft.pickup = undefined;
      } else {
        draft.dropoff = undefined;
      }
      draft.candidates = undefined;
      draft.candidateRole = undefined;
      draft.route = undefined;
      draft.quote = undefined;
      await persistDraft(phone, name, nextState, draft);
      await sendTextMessage(
        phone,
        role === "pickup"
          ? "¿Dónde te recogemos? Escribe el lugar de nuevo."
          : "¿Cuál es tu destino? Escribe el lugar de nuevo.",
      );
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE) {
      const place = role === "pickup" ? draft.pickup : draft.dropoff;
      if (!place) {
        await sendTextMessage(
          phone,
          "No hay un lugar seleccionado. Escribe el nombre del lugar.",
        );
        const nextState =
          role === "pickup" ? "WAITING_PICKUP_TEXT" : "WAITING_DROPOFF_TEXT";
        await persistDraft(phone, name, nextState, draft);
        return true;
      }
      await afterPlaceConfirmed(phone, name, draft, role);
      return true;
    }

    if (message.button?.startsWith(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX)) {
      const index = Number(
        message.button.slice(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX.length),
      );
      const candidates = draft.candidates ?? [];
      const chosen = candidates[index];
      if (!chosen) {
        await sendTextMessage(phone, "Opción inválida. Escribe el lugar de nuevo.");
        return true;
      }
      const resolved = candidateToResolved(chosen);
      if (role === "pickup") {
        draft.pickup = resolved;
      } else {
        draft.dropoff = resolved;
      }
      draft.candidates = undefined;
      await persistDraft(
        phone,
        name,
        role === "pickup" ? "WAITING_PICKUP_CONFIRM" : "WAITING_DROPOFF_CONFIRM",
        draft,
      );
      await sendPlaceForConfirm(phone, resolved);
      return true;
    }
  }

  // --- Text input ---
  if (
    (session.state === "WAITING_PICKUP_TEXT" ||
      session.state === "WAITING_PICKUP" ||
      session.state === "WAITING_DROPOFF_TEXT") &&
    message.text
  ) {
    const role: "pickup" | "dropoff" =
      session.state === "WAITING_DROPOFF_TEXT" ? "dropoff" : "pickup";
    await resolveTextToPlace(phone, name, message.text, role, session);
    return true;
  }

  // Confirm states: ignore stray text gently
  if (
    session.state === "WAITING_PICKUP_CONFIRM" ||
    session.state === "WAITING_DROPOFF_CONFIRM"
  ) {
    await sendTextMessage(
      phone,
      "Confirma el lugar con los botones, elige una opción o comparte tu ubicación.",
    );
    return true;
  }

  return false;
}
