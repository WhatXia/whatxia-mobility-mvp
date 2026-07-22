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
import { candidateToResolved } from "@/lib/geo/geocoding";
import { mapsUrlForCoords, mapsUrlForPlaceId } from "@/lib/geo/maps-url";
import { searchPlaces } from "@/lib/geo/places";
import { estimateRoute } from "@/lib/geo/routes";
import { GoogleMapsError } from "@/lib/geo/client";
import { calculateFare, formatFareCop } from "@/lib/pricing/engine";
import { offerTripToDrivers } from "@/lib/dispatch";
import { clearSession, upsertSession } from "@/lib/sessions";
import {
  getActiveCity,
  isPointInCity,
  outOfCityServiceMessage,
} from "@/lib/city/context";
import {
  sendButtonsMessage,
  sendLocationMessage,
  sendLocationRequestMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";

/**
 * MVP: texto libre (pickupLabel) + ubicación WhatsApp (coords).
 * Futuro: "places_text" para resolver origen solo por nombre con Places.
 */
export const ORIGIN_CAPTURE_MODE:
  | "label_plus_whatsapp_location"
  | "places_text" = "label_plus_whatsapp_location";

export const BOOKING_BUTTON_IDS = {
  CONFIRM_PLACE: "booking_confirm_place",
  REJECT_PLACE: "booking_reject_place",
  SHARE_HINT: "booking_share_hint",
  REQUEST_TRIP: "booking_request_trip",
  CANCEL_QUOTE: "booking_cancel_quote",
  CANDIDATE_PREFIX: "booking_cand:",
} as const;

const BOOKING_STATES: UserState[] = [
  "WAITING_PICKUP_LOCATION",
  "WAITING_PICKUP_TEXT",
  "WAITING_PICKUP_CONFIRM",
  "WAITING_DROPOFF_TEXT",
  "WAITING_DROPOFF_CONFIRM",
  "WAITING_QUOTE_CONFIRM",
  "WAITING_PICKUP",
];

export function isBookingState(state: UserState | undefined): boolean {
  return Boolean(state && BOOKING_STATES.includes(state));
}

function placeLabel(place: ResolvedPlace): string {
  return place.name || place.address || "Ubicación";
}

function pickupDisplayLabel(draft: BookingDraft): string {
  return (
    draft.pickupLabel?.trim() ||
    (draft.pickup ? placeLabel(draft.pickup) : "") ||
    "Origen"
  );
}

const PICKUP_LOCATION_PROMPT = [
  "Perfecto. Ahora comparte tu ubicación actual 📍 para confirmar el punto de recogida y calcular tu tarifa.",
].join("\n");

async function askForPickupLocation(phone: string): Promise<void> {
  // Meta oficial: interactive location_request_message + action send_location
  await sendLocationRequestMessage(phone, PICKUP_LOCATION_PROMPT);
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
    ...top.map(
      (c, i) =>
        `${i + 1}. ${c.name}${c.address ? ` — ${c.address}` : ""}`,
    ),
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
        : draft.pickupLabel?.trim() ||
          (draft.pickup ? placeLabel(draft.pickup) : null),
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
    bookingDraft: {
      originCapture:
        ORIGIN_CAPTURE_MODE === "places_text"
          ? "places_text"
          : "label_plus_whatsapp_location",
    },
    driverName: null,
  });

  await sendTextMessage(phone, "¿Dónde te recogemos?");
}

/** Solo destino en MVP; origen Places si ORIGIN_CAPTURE_MODE === places_text. */
async function resolveTextToPlace(
  phone: string,
  name: string,
  text: string,
  role: "pickup" | "dropoff",
  session: UserSession,
): Promise<void> {
  const draft: BookingDraft = { ...(session.bookingDraft ?? {}) };

  let searchResult;
  try {
    console.log("[booking:places] resolveTextToPlace", {
      role,
      text,
      phone,
    });
    searchResult = await searchPlaces(text);
  } catch (error) {
    console.error("[booking] Places error FULL:", error);
    if (error instanceof GoogleMapsError) {
      console.error("[booking] Places GoogleMapsError", {
        role,
        text,
        status: error.status,
        body: error.bodySnippet,
        message: error.message,
      });
    }
    await sendTextMessage(
      phone,
      "No pudimos buscar el lugar ahora. Intenta de nuevo en un momento.",
    );
    return;
  }

  const { candidates, city, rejectedOutsideCity } = searchResult;

  if (candidates.length === 0) {
    if (rejectedOutsideCity > 0) {
      await sendTextMessage(phone, outOfCityServiceMessage(city));
      return;
    }
    await sendTextMessage(
      phone,
      `No encontramos ese lugar en ${city.name}. Escribe una dirección o punto de referencia más claro.`,
    );
    return;
  }

  draft.candidates = candidates;
  draft.candidateRole = role;

  if (isHighConfidenceMatch(candidates)) {
    const resolved = candidateToResolved(candidates[0]);
    if (!isPointInCity(resolved.location, city)) {
      await sendTextMessage(phone, outOfCityServiceMessage(city));
      return;
    }
    if (role === "pickup") {
      draft.pickup = resolved;
      draft.pickupLabel = resolved.name;
      draft.originCapture = "places_text";
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
  if (!draft.pickup?.location || !draft.dropoff) {
    await sendTextMessage(
      phone,
      "Falta origen o destino. Escribe Hola para reiniciar.",
    );
    return;
  }

  let route = draft.route;
  let quote = draft.quote;

  if (!route || !quote) {
    try {
      route = await estimateRoute(
        draft.pickup.location,
        draft.dropoff.location,
      );
      quote = await calculateFare(route, {
        pickupLabel: pickupDisplayLabel(draft),
        dropoffLabel: placeLabel(draft.dropoff),
        pickupLat: draft.pickup.location.lat,
        pickupLng: draft.pickup.location.lng,
        dropoffLat: draft.dropoff.location.lat,
        dropoffLng: draft.dropoff.location.lng,
      });
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
    `📍 Recoger en: ${pickupDisplayLabel(draft)}`,
    `🎯 Destino: ${placeLabel(draft.dropoff)}`,
    `📏 Distancia estimada: ${quote.distanceKm.toFixed(1)} km`,
    `⏱️ Tiempo estimado: ${quote.durationMin} min`,
    `💰 Valor del servicio: ${formatFareCop(quote.amount)}`,
    "",
    "¿Confirmas el servicio?",
  ].join("\n");

  await sendButtonsMessage(phone, body, [
    { id: BOOKING_BUTTON_IDS.REQUEST_TRIP, title: "✅ Solicitar" },
    { id: BOOKING_BUTTON_IDS.CANCEL_QUOTE, title: "❌ Cancelar" },
  ]);
}

async function afterDropoffConfirmed(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  await buildAndSendQuote(phone, name, {
    ...draft,
    candidates: undefined,
    candidateRole: undefined,
  });
}

/**
 * Maneja mensajes del flujo de cotización geográfica.
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

      const label = pickupDisplayLabel(draft);

      await upsertSession(phone, {
        name,
        state: "SEARCHING_DRIVER",
        pickupNeighborhood: label,
        bookingDraft: draft,
      });

      await sendTextMessage(
        phone,
        "Estamos buscando un conductor. Un momento por favor.",
      );

      // Despacho / asignación: sin cambios de lógica.
      await offerTripToDrivers(phone, label, {
        pickup: {
          ...draft.pickup,
          name: label,
        },
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

  // --- Paso 1: texto libre → pickupLabel ---
  if (
    (session.state === "WAITING_PICKUP_TEXT" ||
      session.state === "WAITING_PICKUP") &&
    message.text
  ) {
    if (ORIGIN_CAPTURE_MODE === "places_text") {
      await resolveTextToPlace(phone, name, message.text, "pickup", session);
      return true;
    }

    const label = message.text.trim();
    if (!label) {
      await sendTextMessage(phone, "¿Dónde te recogemos?");
      return true;
    }

    await persistDraft(
      phone,
      name,
      "WAITING_PICKUP_LOCATION",
      {
        ...draft,
        pickupLabel: label,
        pickup: undefined,
        pickupLocation: undefined,
        originCapture: "label_plus_whatsapp_location",
        route: undefined,
        quote: undefined,
      },
      label,
    );
    await askForPickupLocation(phone);
    return true;
  }

  // --- Paso 2: ubicación WhatsApp obligatoria → pickupLocation ---
  if (session.state === "WAITING_PICKUP_LOCATION") {
    if (message.location) {
      const label = draft.pickupLabel?.trim();
      if (!label) {
        await persistDraft(phone, name, "WAITING_PICKUP_TEXT", {
          ...draft,
          pickup: undefined,
          pickupLocation: undefined,
        });
        await sendTextMessage(phone, "¿Dónde te recogemos?");
        return true;
      }

      const pickupLocation = {
        lat: message.location.lat,
        lng: message.location.lng,
      };

      const city = await getActiveCity();
      if (!isPointInCity(pickupLocation, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        await askForPickupLocation(phone);
        return true;
      }

      const pickup: ResolvedPlace = {
        placeId: null,
        name: label,
        address:
          message.location.address ??
          `${pickupLocation.lat.toFixed(5)}, ${pickupLocation.lng.toFixed(5)}`,
        location: pickupLocation,
      };

      await persistDraft(
        phone,
        name,
        "WAITING_DROPOFF_TEXT",
        {
          ...draft,
          pickupLabel: label,
          pickupLocation,
          pickup,
          originCapture: "label_plus_whatsapp_location",
          route: undefined,
          quote: undefined,
        },
        label,
      );

      await sendTextMessage(
        phone,
        [
          `Recoger en: ${label}`,
          "Ubicación recibida ✅",
          "",
          "¿Cuál es tu destino?",
        ].join("\n"),
      );
      return true;
    }

    if (message.text || message.button === BOOKING_BUTTON_IDS.SHARE_HINT) {
      await askForPickupLocation(phone);
      return true;
    }

    return true;
  }

  // --- Destino: texto Places ---
  if (session.state === "WAITING_DROPOFF_TEXT" && message.text) {
    await resolveTextToPlace(phone, name, message.text, "dropoff", session);
    return true;
  }

  // --- Confirm destino / candidatos ---
  if (session.state === "WAITING_DROPOFF_CONFIRM") {
    if (message.button === BOOKING_BUTTON_IDS.REJECT_PLACE) {
      draft.dropoff = undefined;
      draft.candidates = undefined;
      draft.candidateRole = undefined;
      draft.route = undefined;
      draft.quote = undefined;
      await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
      await sendTextMessage(
        phone,
        "¿Cuál es tu destino? Escribe el lugar de nuevo.",
      );
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE) {
      if (!draft.dropoff) {
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
        await sendTextMessage(phone, "¿Cuál es tu destino?");
        return true;
      }
      const city = await getActiveCity();
      if (!isPointInCity(draft.dropoff.location, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        draft.dropoff = undefined;
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
        await sendTextMessage(phone, "¿Cuál es tu destino?");
        return true;
      }
      await afterDropoffConfirmed(phone, name, draft);
      return true;
    }

    if (message.button?.startsWith(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX)) {
      const index = Number(
        message.button.slice(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX.length),
      );
      const chosen = (draft.candidates ?? [])[index];
      if (!chosen) {
        await sendTextMessage(
          phone,
          "Opción inválida. Escribe el lugar de nuevo.",
        );
        return true;
      }
      draft.dropoff = candidateToResolved(chosen);
      draft.candidates = undefined;
      await persistDraft(phone, name, "WAITING_DROPOFF_CONFIRM", draft);
      await sendPlaceForConfirm(phone, draft.dropoff);
      return true;
    }

    await sendTextMessage(
      phone,
      "Confirma el destino con los botones o elige una opción de la lista.",
    );
    return true;
  }

  // Futuro: confirm de origen vía Places
  if (session.state === "WAITING_PICKUP_CONFIRM") {
    if (message.button === BOOKING_BUTTON_IDS.REJECT_PLACE) {
      await persistDraft(phone, name, "WAITING_PICKUP_TEXT", {
        ...draft,
        pickup: undefined,
        pickupLabel: undefined,
        candidates: undefined,
      });
      await sendTextMessage(phone, "¿Dónde te recogemos?");
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE && draft.pickup) {
      if (ORIGIN_CAPTURE_MODE === "places_text") {
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", {
          ...draft,
          candidates: undefined,
        });
        await sendTextMessage(phone, "¿Cuál es tu destino?");
        return true;
      }
    }

    if (message.button?.startsWith(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX)) {
      const index = Number(
        message.button.slice(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX.length),
      );
      const chosen = (draft.candidates ?? [])[index];
      if (chosen) {
        draft.pickup = candidateToResolved(chosen);
        draft.pickupLabel = chosen.name;
        await persistDraft(phone, name, "WAITING_PICKUP_CONFIRM", draft);
        await sendPlaceForConfirm(phone, draft.pickup);
      }
      return true;
    }
  }

  return false;
}
