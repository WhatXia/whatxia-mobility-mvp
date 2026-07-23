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
import {
  estimateFare,
  formatTariffCop,
  tariffQuoteToFareQuote,
} from "@/lib/tariff";
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
  /** Destino no encontrado: pedir pin del mapa. */
  SHARE_DROPOFF_LOCATION: "booking_share_dropoff",
  /** Destino no encontrado: volver a escribir. */
  RETRY_DROPOFF_TEXT: "booking_retry_dropoff",
  REQUEST_TRIP: "booking_request_trip",
  CANCEL_QUOTE: "booking_cancel_quote",
  CANDIDATE_PREFIX: "booking_cand:",
} as const;

const BOOKING_STATES: UserState[] = [
  "WAITING_PICKUP_LOCATION",
  "WAITING_PICKUP_TEXT",
  "WAITING_PICKUP_CONFIRM",
  "WAITING_DROPOFF_TEXT",
  "WAITING_DROPOFF_LOCATION",
  "WAITING_DROPOFF_CONFIRM",
  "WAITING_QUOTE_CONFIRM",
  "WAITING_PICKUP",
];

const DROPOFF_NOT_FOUND_BODY = [
  "Ups, no logramos encontrar ese destino.",
  "",
  "Puedes intentar una de estas opciones:",
  "",
  "📍 Compartir la ubicación en el mapa.",
  "✍️ Escribir nuevamente el destino.",
].join("\n");

const DROPOFF_LOCATION_PROMPT =
  "Comparte la ubicación del destino en el mapa 📍 para continuar con tu cotización.";

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
  "Comparte tu ubicación actual 📍 para confirmar el punto de recogida y calcular tu tarifa.",
].join("\n");

const DEFAULT_PICKUP_LABEL = "Punto de recogida";

const ASK_DESTINATION = "¿Hacia dónde deseas ir?";

async function askForPickupLocation(
  phone: string,
  dropoffLabel?: string | null,
): Promise<void> {
  // Meta oficial: interactive location_request_message + action send_location
  const body = dropoffLabel?.trim()
    ? [`Destino: ${dropoffLabel.trim()}`, "", PICKUP_LOCATION_PROMPT].join("\n")
    : PICKUP_LOCATION_PROMPT;
  await sendLocationRequestMessage(phone, body);
}

async function askForDropoffLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, DROPOFF_LOCATION_PROMPT);
}

/**
 * Sprint 29: destino no encontrado → alternativas, sin culpar al usuario
 * ni reiniciar origen / conversación.
 */
async function offerDropoffNotFoundOptions(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  const next: BookingDraft = {
    ...draft,
    dropoff: undefined,
    candidates: undefined,
    candidateRole: undefined,
    route: undefined,
    quote: undefined,
  };
  // Conserva pickup / pickupLabel / pickupLocation.
  await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", next);
  await sendButtonsMessage(phone, DROPOFF_NOT_FOUND_BODY, [
    {
      id: BOOKING_BUTTON_IDS.SHARE_DROPOFF_LOCATION,
      title: "Ubicación en mapa",
    },
    {
      id: BOOKING_BUTTON_IDS.RETRY_DROPOFF_TEXT,
      title: "Escribir destino",
    },
  ]);
}

async function applyDropoffFromWhatsAppLocation(
  phone: string,
  name: string,
  draft: BookingDraft,
  location: { lat: number; lng: number; name: string | null; address: string | null },
): Promise<void> {
  const dropoffLocation = { lat: location.lat, lng: location.lng };
  const city = await getActiveCity();

  if (!isPointInCity(dropoffLocation, city)) {
    await sendTextMessage(phone, outOfCityServiceMessage(city));
    await offerDropoffNotFoundOptions(phone, name, draft);
    return;
  }

  const dropoff: ResolvedPlace = {
    placeId: null,
    name: location.name?.trim() || "Destino en el mapa",
    address:
      location.address?.trim() ||
      `${dropoffLocation.lat.toFixed(5)}, ${dropoffLocation.lng.toFixed(5)}`,
    location: dropoffLocation,
  };

  await afterDropoffConfirmed(phone, name, {
    ...draft,
    dropoff,
    candidates: undefined,
    candidateRole: undefined,
    route: undefined,
    quote: undefined,
  });
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
  await startBookingDestinationFirst(phone, name, null);
}

/**
 * Entrada natural: destino primero (opcionalmente ya extraído del texto).
 * Luego solo pide ubicación de recogida (share location).
 */
export async function startBookingDestinationFirst(
  phone: string,
  name: string,
  destinationText: string | null,
): Promise<void> {
  const draft: BookingDraft = {
    originCapture: "label_plus_whatsapp_location",
    pickupLabel: DEFAULT_PICKUP_LABEL,
  };

  await upsertSession(phone, {
    name,
    state: "WAITING_DROPOFF_TEXT",
    pickupNeighborhood: null,
    bookingDraft: draft,
    driverName: null,
  });

  if (destinationText?.trim()) {
    const session: UserSession = {
      phone,
      name,
      state: "WAITING_DROPOFF_TEXT",
      pickupNeighborhood: null,
      driverName: null,
      driverDraft: null,
      driverFlowStep: null,
      driverUpdateCategory: null,
      driverUpdateField: null,
      bookingDraft: draft,
    };
    await resolveTextToPlace(
      phone,
      name,
      destinationText.trim(),
      "dropoff",
      session,
    );
    return;
  }

  await sendTextMessage(phone, ASK_DESTINATION);
}

async function proceedAfterDropoffReady(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  if (draft.pickup?.location) {
    await buildAndSendQuote(phone, name, {
      ...draft,
      candidates: undefined,
      candidateRole: undefined,
    });
    return;
  }

  const next: BookingDraft = {
    ...draft,
    pickupLabel: draft.pickupLabel?.trim() || DEFAULT_PICKUP_LABEL,
    candidates: undefined,
    candidateRole: undefined,
    route: undefined,
    quote: undefined,
  };
  await persistDraft(phone, name, "WAITING_PICKUP_LOCATION", next);
  await askForPickupLocation(
    phone,
    next.dropoff ? placeLabel(next.dropoff) : null,
  );
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
    if (role === "dropoff") {
      await offerDropoffNotFoundOptions(phone, name, draft);
      return;
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
      if (role === "dropoff") {
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", {
          ...draft,
          dropoff: undefined,
          candidates: undefined,
          route: undefined,
          quote: undefined,
        });
        await sendTextMessage(
          phone,
          "Puedes escribir otro destino dentro de la ciudad o compartir la ubicación en el mapa.",
        );
      }
      return;
    }
    if (role === "dropoff") {
      await offerDropoffNotFoundOptions(phone, name, draft);
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
      const city = await getActiveCity();
      const tariff = await estimateFare({
        citySlug: city.slug,
        origin: {
          lat: draft.pickup.location.lat,
          lng: draft.pickup.location.lng,
          label: pickupDisplayLabel(draft),
        },
        destination: {
          lat: draft.dropoff.location.lat,
          lng: draft.dropoff.location.lng,
          label: placeLabel(draft.dropoff),
        },
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      });
      quote = tariffQuoteToFareQuote(tariff);
    } catch (error) {
      console.error("[booking] Routes/tariff error:", error);
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
    `💰 Valor del servicio: ${formatTariffCop(quote.amount)}`,
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
  await proceedAfterDropoffReady(phone, name, {
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

  // --- Paso: ubicación WhatsApp → pickupLocation ---
  if (session.state === "WAITING_PICKUP_LOCATION") {
    if (message.location) {
      const label =
        draft.pickupLabel?.trim() ||
        message.location.name?.trim() ||
        DEFAULT_PICKUP_LABEL;

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

      const nextDraft: BookingDraft = {
        ...draft,
        pickupLabel: label,
        pickupLocation,
        pickup,
        originCapture: "label_plus_whatsapp_location",
        route: undefined,
        quote: undefined,
      };

      await persistDraft(phone, name, "WAITING_PICKUP_LOCATION", nextDraft, label);

      // Destino ya en slots → cotizar; si no, pedir destino.
      if (nextDraft.dropoff?.location) {
        await buildAndSendQuote(phone, name, nextDraft);
        return true;
      }

      await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", nextDraft, label);
      await sendTextMessage(
        phone,
        [
          `Recoger en: ${label}`,
          "Ubicación recibida ✅",
          "",
          ASK_DESTINATION,
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

  // --- Destino: texto Places, ubicación mapa, o recuperación Sprint 29 ---
  if (
    session.state === "WAITING_DROPOFF_TEXT" ||
    session.state === "WAITING_DROPOFF_LOCATION"
  ) {
    if (message.button === BOOKING_BUTTON_IDS.SHARE_DROPOFF_LOCATION) {
      await persistDraft(phone, name, "WAITING_DROPOFF_LOCATION", {
        ...draft,
        dropoff: undefined,
        route: undefined,
        quote: undefined,
      });
      await askForDropoffLocation(phone);
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.RETRY_DROPOFF_TEXT) {
      await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", {
        ...draft,
        dropoff: undefined,
        candidates: undefined,
        route: undefined,
        quote: undefined,
      });
      await sendTextMessage(phone, "Escribe nuevamente tu destino:");
      return true;
    }

    if (message.location) {
      await applyDropoffFromWhatsAppLocation(
        phone,
        name,
        draft,
        message.location,
      );
      return true;
    }

    if (session.state === "WAITING_DROPOFF_LOCATION") {
      // Sigue esperando pin; texto → nueva búsqueda Places.
      if (message.text) {
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
        await resolveTextToPlace(phone, name, message.text, "dropoff", {
          ...session,
          bookingDraft: draft,
        });
        return true;
      }
      await askForDropoffLocation(phone);
      return true;
    }

    if (message.text) {
      await resolveTextToPlace(phone, name, message.text, "dropoff", session);
      return true;
    }

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
      await offerDropoffNotFoundOptions(phone, name, draft);
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE) {
      if (!draft.dropoff) {
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
        await sendTextMessage(phone, ASK_DESTINATION);
        return true;
      }
      const city = await getActiveCity();
      if (!isPointInCity(draft.dropoff.location, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        draft.dropoff = undefined;
        await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft);
        await sendTextMessage(phone, ASK_DESTINATION);
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
        await sendTextMessage(phone, ASK_DESTINATION);
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
