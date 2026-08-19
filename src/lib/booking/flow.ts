import type {
  IncomingLocation,
  IncomingMessage,
  UserSession,
  UserState,
} from "@/types";
import type {
  BookingDraft,
  GeoPoint,
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
  tariffQuoteToFareQuote,
} from "@/lib/tariff";
import { formatCopSymbol, ESTIMATED_FARE_RANGE_MARGIN_COP } from "@/lib/tariff/present-estimate";
import { offerTripToDrivers } from "@/lib/dispatch";
import { computeAutomaticEtaRange } from "@/lib/eta-auto";
import {
  pickupOfferZone,
  resolvePickupLabelFromText,
} from "@/lib/booking/intent";
import { clearSession, upsertSession } from "@/lib/sessions";
import {
  getActiveCity,
  isPointInCity,
  outOfCityServiceMessage,
} from "@/lib/city/context";
import { catalogBody, cms, cmsSync } from "@/lib/bot-cms/copy";
import {
  sendButtonsMessage,
  sendLocationMessage,
  sendLocationRequestMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";

/**
 * Tras una dirección/zona de recogida, el GPS de WhatsApp es el punto exacto.
 * Places no se usa para resolver el pickup inicial (sí para destino).
 */
export const ORIGIN_CAPTURE_MODE:
  | "label_plus_whatsapp_location"
  | "places_text" = "label_plus_whatsapp_location";

/**
 * true → flujo completo: origen → destino (Places) → cotización → Solicitar/Cancelar.
 * false → pickup resuelto → crear viaje / dispatch (sin destino ni cotización).
 */
export const BOOKING_REQUIRE_DROPOFF = true;

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
  "WAITING_BOOKING_NAME",
];

const DROPOFF_NOT_FOUND_BODY = catalogBody("P_DROPOFF_NOT_FOUND");

const DROPOFF_LOCATION_PROMPT = catalogBody("P_DROPOFF_LOCATION_PROMPT");

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

function pickupZoneLabel(draft: BookingDraft): string {
  return pickupOfferZone(pickupDisplayLabel(draft)) || DEFAULT_PICKUP_LABEL;
}

/** Pickup exacto = GPS WhatsApp; name/address conservan el texto del pasajero. */
export function buildPickupPlaceFromGps(
  descriptiveLabel: string,
  point: GeoPoint,
): ResolvedPlace {
  const name = descriptiveLabel.trim() || DEFAULT_PICKUP_LABEL;
  return {
    placeId: null,
    name,
    address: name,
    location: point,
  };
}

const PICKUP_LOCATION_PROMPT = catalogBody("P_PICKUP_LOCATION_PROMPT");

const DEFAULT_PICKUP_LABEL = "Punto de recogida";

const ASK_DESTINATION = catalogBody("P_ASK_DESTINATION");

function askDestinationAfterPickup(_label: string): string {
  return ASK_DESTINATION;
}

const ASK_BOOKING_NAME = "¿Me recuerdas tu nombre, por favor?";

function isBlockedBookingName(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return (
    normalized === "hola" ||
    normalized === "buenas" ||
    normalized === "buenos dias" ||
    normalized === "buenas tardes" ||
    normalized === "buenas noches"
  );
}

async function passengerNeedsBookingName(phone: string): Promise<boolean> {
  const { findPassengerByPhone } = await import("@/lib/supabase/passengers");
  const passenger = await findPassengerByPhone(phone);
  if (!passenger) {
    return true;
  }
  return !(
    passenger.preferred_name?.trim() ||
    passenger.name?.trim() ||
    passenger.full_name?.trim()
  );
}

async function saveBookingPassengerName(
  phone: string,
  rawName: string,
): Promise<string> {
  const {
    findOrCreatePassenger,
    hasFullName,
    setPassengerFullName,
    setPassengerPreferredName,
  } = await import("@/lib/supabase/passengers");

  const trimmed = rawName.trim().slice(0, 80);
  await findOrCreatePassenger(phone);
  const withPreferred = await setPassengerPreferredName(phone, trimmed);
  if (!withPreferred || !hasFullName(withPreferred)) {
    await setPassengerFullName(phone, trimmed);
  }
  return trimmed;
}

/**
 * Tras origen resuelto: pedir nombre si falta, luego lanzar viaje (o destino si se reactiva).
 */
async function maybeAskNameThenContinueAfterPickup(
  phone: string,
  name: string,
  draft: BookingDraft,
  session: UserSession,
): Promise<void> {
  if (await passengerNeedsBookingName(phone)) {
    await persistDraft(phone, name, "WAITING_BOOKING_NAME", draft);
    await sendTextMessage(phone, ASK_BOOKING_NAME);
    return;
  }
  await continueAfterPickupCaptured(phone, name, draft, session);
}

/**
 * Punto único de lanzamiento: misma lógica que el botón REQUEST_TRIP.
 * persist SEARCHING_DRIVER → P_SEARCHING_DRIVER → offerTripToDrivers → createTrip.
 */
async function launchTripFromDraft(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  console.log("[publish:diag] STEP_0_REQUEST_TRIP_enter", {
    phone,
    hasPickup: Boolean(draft.pickup),
    hasDropoff: Boolean(draft.dropoff),
    hasRoute: Boolean(draft.route),
    hasQuote: Boolean(draft.quote),
    quotedAmount: draft.quote?.amount ?? null,
    requireDropoff: BOOKING_REQUIRE_DROPOFF,
    autoLaunch: true,
  });

  const dropoffReady = Boolean(draft.dropoff && draft.route && draft.quote);
  if (!draft.pickup || (BOOKING_REQUIRE_DROPOFF && !dropoffReady)) {
    console.warn("[publish:diag] STOP_at_REQUEST_TRIP_incomplete_draft", {
      phone,
      continues: false,
    });
    await sendTextMessage(phone, await cms("P_QUOTE_EXPIRED"));
    await clearSession(phone);
    return;
  }

  const { assertPassengerCanRequestService } = await import(
    "@/lib/passenger-access"
  );
  if (!(await assertPassengerCanRequestService(phone, name))) {
    await clearSession(phone);
    return;
  }

  const zone = pickupZoneLabel(draft);
  const fullLabel = pickupDisplayLabel(draft);

  await upsertSession(phone, {
    name,
    state: "SEARCHING_DRIVER",
    pickupNeighborhood: zone,
    bookingDraft: draft,
  });

  await sendTextMessage(phone, await cms("P_SEARCHING_DRIVER"));

  console.log("[publish:diag] STEP_0b_calling_offerTripToDrivers", {
    phone,
    label: zone,
    note: "Lanzamiento directo: offerTripToDrivers → createTrip SEARCHING",
    continues: true,
  });

  try {
    await offerTripToDrivers(
      phone,
      zone,
      dropoffReady
        ? {
            pickup: {
              ...draft.pickup,
              name: fullLabel,
              address: fullLabel,
            },
            dropoff: draft.dropoff!,
            route: draft.route!,
            quote: draft.quote!,
          }
        : {
            pickup: {
              ...draft.pickup,
              name: fullLabel,
              address: fullLabel,
            },
          },
    );
    console.log("[publish:diag] STEP_0c_offerTripToDrivers_returned", {
      phone,
      continues: true,
    });
  } catch (error) {
    console.error("[publish:diag] STOP_at_offerTripToDrivers_threw", {
      phone,
      continues: false,
      error,
      errorMessage:
        error && typeof error === "object" && "message" in error
          ? (error as { message?: string }).message
          : String(error),
      errorCode:
        error && typeof error === "object" && "code" in error
          ? (error as { code?: string }).code
          : null,
    });
    throw error;
  }
}

/**
 * Resumen sin destino: conservado para sesiones WAITING_QUOTE_CONFIRM ya abiertas.
 */
async function buildAndSendServiceSummary(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  if (!draft.pickup?.location) {
    await sendTextMessage(phone, await cms("P_QUOTE_MISSING_PLACES"));
    return;
  }

  const pickup = pickupDisplayLabel(draft);
  const fast = computeAutomaticEtaRange(0);
  const slow = computeAutomaticEtaRange(61);
  const displayName = name.trim() || "amigo";

  await persistDraft(phone, name, "WAITING_QUOTE_CONFIRM", {
    ...draft,
    candidates: undefined,
    candidateRole: undefined,
    pendingDropoffText: undefined,
  });

  const body = [
    `${displayName}, tu servicio:`,
    "",
    "📍 Punto de recogida:",
    pickup,
    "",
    "⏱️ Tiempo aproximado de llegada:",
    `${fast.minMinutes}–${slow.maxMinutes} minutos`,
    "",
    "💰 Recuerda:",
    "El servicio tiene un costo adicional de $800 por solicitud.",
    "",
    "¿Solicitamos tu servicio?",
  ].join("\n");

  await sendButtonsMessage(phone, body, [
    { id: BOOKING_BUTTON_IDS.REQUEST_TRIP, title: "✅ Solicitar" },
    { id: BOOKING_BUTTON_IDS.CANCEL_QUOTE, title: "❌ Cancelar" },
  ]);
}

async function continueAfterPickupCaptured(
  phone: string,
  name: string,
  draft: BookingDraft,
  session: UserSession,
): Promise<void> {
  // Launch: pickup resuelto → crear viaje / búsqueda, sin Solicitar/Cancelar.
  if (!BOOKING_REQUIRE_DROPOFF) {
    await launchTripFromDraft(phone, name, {
      ...draft,
      candidates: undefined,
      candidateRole: undefined,
      pendingDropoffText: undefined,
    });
    return;
  }

  const label =
    draft.pickupLabel?.trim() ||
    (draft.pickup ? placeLabel(draft.pickup) : "") ||
    DEFAULT_PICKUP_LABEL;

  if (draft.dropoff?.location) {
    await buildAndSendQuote(phone, name, draft);
    return;
  }

  const pendingDropoff = draft.pendingDropoffText?.trim();
  if (pendingDropoff) {
    const cleared: BookingDraft = {
      ...draft,
      pendingDropoffText: undefined,
    };
    await persistDraft(
      phone,
      name,
      "WAITING_DROPOFF_TEXT",
      cleared,
      pickupZoneLabel(cleared),
    );
    await sendTextMessage(
      phone,
      await cms("P_PICKUP_CONFIRMED_LABEL", { label }),
    );
    await resolveTextToPlace(phone, name, pendingDropoff, "dropoff", {
      ...session,
      state: "WAITING_DROPOFF_TEXT",
      bookingDraft: cleared,
    });
    return;
  }

  await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", draft, pickupZoneLabel(draft));
  await sendTextMessage(phone, askDestinationAfterPickup(label));
}

async function askForPickupLocation(
  phone: string,
  pickupLabel?: string | null,
): Promise<void> {
  // Meta oficial: interactive location_request_message + action send_location
  const body = pickupLabel?.trim()
    ? cmsSync("P_PICKUP_LOCATION_WITH_LABEL", {
        pickup_label: pickupLabel.trim(),
      })
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
    await cms("P_PLACE_CONFIRM", {
      place_label: placeLabel(place),
      address: place.address ? `\n${place.address}` : "",
      maps_link: mapsLink,
    }),
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
  const candidatesList = top
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}${c.address ? ` — ${c.address}` : ""}`,
    )
    .join("\n");

  await sendButtonsMessage(
    phone,
    (
      await cms("P_PLACE_CANDIDATES", { candidates_list: candidatesList })
    ).slice(0, 1024),
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
        : draft.pickupLabel?.trim()
          ? pickupOfferZone(draft.pickupLabel)
          : (draft.pickup ? pickupOfferZone(placeLabel(draft.pickup)) : null),
  });
}

export async function startBookingFlow(
  phone: string,
  name: string,
): Promise<void> {
  const { assertPassengerCanRequestService } = await import(
    "@/lib/passenger-access"
  );
  if (!(await assertPassengerCanRequestService(phone, name))) {
    return;
  }
  await startBookingFromIntent(phone, name, {
    pickupText: null,
    destinationText: null,
  });
}

/**
 * Cotización directa desde un recorrido favorito (origen + destino guardados).
 * No pide ubicación ni destino de nuevo.
 */
export async function startBookingFromFavorite(
  phone: string,
  name: string,
  favorite: {
    pickupLat: number;
    pickupLng: number;
    pickupLabel: string;
    pickupPlaceId: string | null;
    dropoffLat: number;
    dropoffLng: number;
    dropoffLabel: string;
    dropoffPlaceId: string | null;
  },
): Promise<void> {
  const { assertPassengerCanRequestService } = await import(
    "@/lib/passenger-access"
  );
  if (!(await assertPassengerCanRequestService(phone, name))) {
    return;
  }

  const city = await getActiveCity();
  const pickupLoc = { lat: favorite.pickupLat, lng: favorite.pickupLng };
  const dropoffLoc = { lat: favorite.dropoffLat, lng: favorite.dropoffLng };

  if (!isPointInCity(pickupLoc, city) || !isPointInCity(dropoffLoc, city)) {
    await sendTextMessage(phone, outOfCityServiceMessage(city));
    return;
  }

  const pickup: ResolvedPlace = {
    placeId: favorite.pickupPlaceId,
    name: favorite.pickupLabel,
    address: favorite.pickupLabel,
    location: pickupLoc,
  };
  const dropoff: ResolvedPlace = {
    placeId: favorite.dropoffPlaceId,
    name: favorite.dropoffLabel,
    address: favorite.dropoffLabel,
    location: dropoffLoc,
  };

  await buildAndSendQuote(phone, name, {
    pickup,
    pickupLabel: favorite.pickupLabel,
    dropoff,
    originCapture: "label_plus_whatsapp_location",
  });
}

export type BookingIntentSlots = {
  pickupText: string | null;
  destinationText: string | null;
};

/**
 * Entrada natural (Agent Zero):
 * - Un lugar → conservar texto + pedir GPS WhatsApp (punto exacto)
 * - Origen + destino claros → GPS origen, destino pendiente para Places
 * - Solo intención / Solicitar servicio → "¿Dónde te recogemos?"
 */
export async function startBookingFromIntent(
  phone: string,
  name: string,
  slots: BookingIntentSlots,
): Promise<void> {
  const { assertPassengerCanRequestService } = await import(
    "@/lib/passenger-access"
  );
  if (!(await assertPassengerCanRequestService(phone, name))) {
    return;
  }

  const pickupText = slots.pickupText?.trim() || null;
  const destinationText = slots.destinationText?.trim() || null;

  if (pickupText) {
    await startPickupLocationStep(phone, name, {
      pickupLabel: pickupText,
      pendingDropoffText: BOOKING_REQUIRE_DROPOFF
        ? destinationText ?? undefined
        : undefined,
    });
    return;
  }

  // Solicitar servicio sin lugar: primero texto de recogida; luego GPS obligatorio.
  await persistDraft(phone, name, "WAITING_PICKUP_TEXT", {
    originCapture: "label_plus_whatsapp_location",
  });
  await sendTextMessage(phone, await cms("P_ASK_PICKUP_TEXT"));
}

/** @deprecated Usar startBookingFromIntent (origen primero). */
export async function startBookingDestinationFirst(
  phone: string,
  name: string,
  destinationText: string | null,
): Promise<void> {
  await startBookingFromIntent(phone, name, {
    pickupText: destinationText,
    destinationText: null,
  });
}

async function startPickupLocationStep(
  phone: string,
  name: string,
  opts: { pickupLabel: string; pendingDropoffText?: string },
): Promise<void> {
  const draft: BookingDraft = {
    originCapture: "label_plus_whatsapp_location",
    pickupLabel: opts.pickupLabel.trim() || DEFAULT_PICKUP_LABEL,
    pendingDropoffText: opts.pendingDropoffText?.trim() || undefined,
  };

  await persistDraft(phone, name, "WAITING_PICKUP_LOCATION", draft, pickupZoneLabel(draft));
  await askForPickupLocation(phone, pickupZoneLabel(draft));
}

function passengerPickupLabel(draft: BookingDraft, fallback: string): string {
  return (
    draft.pickupLabel?.trim() ||
    fallback.trim() ||
    DEFAULT_PICKUP_LABEL
  );
}

async function fallbackPickupToGps(
  phone: string,
  name: string,
  draft: BookingDraft,
  label: string,
): Promise<void> {
  await startPickupLocationStep(phone, name, {
    pickupLabel: passengerPickupLabel(draft, label),
    pendingDropoffText: draft.pendingDropoffText,
  });
}

async function continueWithResolvedPickup(
  phone: string,
  name: string,
  draft: BookingDraft,
  _resolved: ResolvedPlace,
  originalLabel: string,
  _session: UserSession,
): Promise<void> {
  await fallbackPickupToGps(
    phone,
    name,
    {
      ...draft,
      pickup: undefined,
      pickupLocation: undefined,
      originCapture: "label_plus_whatsapp_location",
      candidates: undefined,
      candidateRole: undefined,
      route: undefined,
      quote: undefined,
    },
    originalLabel,
  );
}

async function applyPickupFromWhatsAppLocation(
  phone: string,
  name: string,
  draft: BookingDraft,
  location: IncomingLocation,
  session: UserSession,
): Promise<void> {
  const label =
    (draft.pickupLabel?.trim() &&
    draft.pickupLabel.trim() !== DEFAULT_PICKUP_LABEL
      ? draft.pickupLabel.trim()
      : null) ||
    location.name?.trim() ||
    draft.pickupLabel?.trim() ||
    DEFAULT_PICKUP_LABEL;

  const pickupLocation = {
    lat: location.lat,
    lng: location.lng,
  };

  const city = await getActiveCity();
  if (!isPointInCity(pickupLocation, city)) {
    await sendTextMessage(phone, outOfCityServiceMessage(city));
    await askForPickupLocation(phone, pickupOfferZone(label));
    return;
  }

  const pickup = buildPickupPlaceFromGps(label, pickupLocation);

  const nextDraft: BookingDraft = {
    ...draft,
    pickupLabel: label,
    pickupLocation,
    pickup,
    originCapture: "label_plus_whatsapp_location",
    route: undefined,
    quote: undefined,
  };

  await persistDraft(
    phone,
    name,
    "WAITING_PICKUP_LOCATION",
    nextDraft,
    pickupOfferZone(label),
  );
  await maybeAskNameThenContinueAfterPickup(phone, name, nextDraft, session);
}

/**
 * Resuelve origen y destino con Places (alta confianza) y cotiza.
 * @returns true si se envió cotización; false si hay que caer al flujo con ubicación.
 */
async function tryQuoteFromBothPlaces(
  phone: string,
  name: string,
  pickupText: string,
  destinationText: string,
): Promise<boolean> {
  console.log("[booking] resolución dual origen+destino", {
    phone,
    pickupText,
    destinationText,
  });

  let pickupSearch;
  let dropoffSearch;
  try {
    pickupSearch = await searchPlaces(pickupText);
    dropoffSearch = await searchPlaces(destinationText);
  } catch (error) {
    console.error("[booking] Places dual error:", error);
    return false;
  }

  const city = await getActiveCity();

  const pickupResolved = pickResolvedPlace(pickupSearch.candidates, city);
  const dropoffResolved = pickResolvedPlace(dropoffSearch.candidates, city);

  if (!pickupResolved || !dropoffResolved) {
    console.log("[booking] dual Places: sin alta confianza o fuera de ciudad", {
      pickupOk: Boolean(pickupResolved),
      dropoffOk: Boolean(dropoffResolved),
    });
    return false;
  }

  const draft: BookingDraft = {
    originCapture: "places_text",
    pickupLabel: placeLabel(pickupResolved),
    pickupLocation: pickupResolved.location,
    pickup: pickupResolved,
    dropoff: dropoffResolved,
  };

  // Nombre post-origen si aún no está guardado (sin onboarding previo).
  // Con destino reactivado (BOOKING_REQUIRE_DROPOFF) sigue el dual Places.
  if (await passengerNeedsBookingName(phone)) {
    await persistDraft(phone, name, "WAITING_BOOKING_NAME", draft);
    await sendTextMessage(phone, ASK_BOOKING_NAME);
    return true;
  }

  if (!BOOKING_REQUIRE_DROPOFF) {
    await launchTripFromDraft(phone, name, draft);
    return true;
  }

  await buildAndSendQuote(phone, name, draft);
  return true;
}

function pickResolvedPlace(
  candidates: PlaceCandidate[],
  city: Awaited<ReturnType<typeof getActiveCity>>,
): ResolvedPlace | null {
  if (candidates.length === 0) {
    return null;
  }
  if (!isHighConfidenceMatch(candidates) && candidates.length > 1) {
    return null;
  }
  const resolved = candidateToResolved(candidates[0]);
  if (!isPointInCity(resolved.location, city)) {
    return null;
  }
  return resolved;
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
      pendingDropoffText: undefined,
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
  await persistDraft(phone, name, "WAITING_PICKUP_LOCATION", next, pickupZoneLabel(next));
  await askForPickupLocation(phone, pickupZoneLabel(next));
}

/** Destino: Places. Pickup: GPS WhatsApp obligatorio (no Places). */
async function resolveTextToPlace(
  phone: string,
  name: string,
  text: string,
  role: "pickup" | "dropoff",
  session: UserSession,
): Promise<void> {
  const draft: BookingDraft = { ...(session.bookingDraft ?? {}) };
  if (role === "pickup") {
    if (!draft.pickupLabel?.trim()) {
      draft.pickupLabel = text.trim();
    }
    await fallbackPickupToGps(phone, name, draft, text);
    return;
  }

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
    await offerDropoffNotFoundOptions(phone, name, draft);
    return;
  }

  const { candidates, city, rejectedOutsideCity } = searchResult;

  if (candidates.length === 0) {
    if (rejectedOutsideCity > 0) {
      await sendTextMessage(phone, outOfCityServiceMessage(city));
      await persistDraft(phone, name, "WAITING_DROPOFF_TEXT", {
        ...draft,
        dropoff: undefined,
        candidates: undefined,
        route: undefined,
        quote: undefined,
      });
      await sendTextMessage(phone, await cms("P_DROPOFF_RETRY_HINT"));
      return;
    }
    await offerDropoffNotFoundOptions(phone, name, draft);
    return;
  }

  draft.candidates = candidates;
  draft.candidateRole = "dropoff";

  if (isHighConfidenceMatch(candidates)) {
    const resolved = candidateToResolved(candidates[0]);
    if (!isPointInCity(resolved.location, city)) {
      await sendTextMessage(phone, outOfCityServiceMessage(city));
      await offerDropoffNotFoundOptions(phone, name, {
        ...draft,
        dropoff: undefined,
        candidates: undefined,
      });
      return;
    }

    draft.dropoff = resolved;
    draft.candidates = undefined;
    draft.candidateRole = undefined;
    console.log("[booking] destino alta confianza → cotización directa", {
      placeId: resolved.placeId,
      name: resolved.name,
    });
    await afterDropoffConfirmed(phone, name, draft);
    return;
  }

  await persistDraft(phone, name, "WAITING_DROPOFF_CONFIRM", draft);
  await sendCandidateList(phone, candidates);
}

async function buildAndSendQuote(
  phone: string,
  name: string,
  draft: BookingDraft,
): Promise<void> {
  console.log("[publish:diag] STEP_P0_PricingEngine_enter", {
    phone,
    hasPickup: Boolean(draft.pickup?.location),
    hasDropoff: Boolean(draft.dropoff),
    hasCachedRoute: Boolean(draft.route),
    hasCachedQuote: Boolean(draft.quote),
    note: "Equivale a PricingEngine (estimateRoute + estimateFare)",
  });

  if (!draft.pickup?.location || !draft.dropoff) {
    console.warn("[publish:diag] STOP_at_PricingEngine_missing_places", {
      phone,
      continues: false,
    });
    await sendTextMessage(phone, await cms("P_QUOTE_MISSING_PLACES"));
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
      console.log("[publish:diag] STEP_P1_PricingEngine_ok", {
        phone,
        amount: quote.amount,
        distanceMeters: route.distanceMeters,
        continues: true,
      });
    } catch (error) {
      console.error("[booking] Routes/tariff error:", error);
      console.error("[publish:diag] STOP_at_PricingEngine", {
        phone,
        continues: false,
        error,
      });
      await sendTextMessage(phone, await cms("P_QUOTE_ROUTE_ERROR"));
      return;
    }
  } else {
    console.log("[publish:diag] STEP_P1_PricingEngine_cached", {
      phone,
      amount: quote.amount,
      continues: true,
    });
  }

  const nextDraft: BookingDraft = {
    ...draft,
    route,
    quote,
    candidates: undefined,
    candidateRole: undefined,
  };

  await persistDraft(phone, name, "WAITING_QUOTE_CONFIRM", nextDraft);

  const body = await cms("P_QUOTE_CONFIRM", {
    pickup: pickupDisplayLabel(draft),
    dropoff: placeLabel(draft.dropoff!),
    min: formatCopSymbol(quote.amount),
    max: formatCopSymbol(quote.amount + ESTIMATED_FARE_RANGE_MARGIN_COP),
  });

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
      const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
      await sendPassengerActionMenu(phone, name, {
        body: await cms("P_BOOKING_CANCELLED"),
      });
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.REQUEST_TRIP) {
      await launchTripFromDraft(phone, name, draft);
      return true;
    }

    await sendTextMessage(phone, await cms("P_QUOTE_USE_BUTTONS"));
    return true;
  }

  // --- Paso 1: texto libre → pedir GPS WhatsApp (punto exacto) ---
  if (
    session.state === "WAITING_PICKUP_TEXT" ||
    session.state === "WAITING_PICKUP"
  ) {
    if (message.location) {
      await applyPickupFromWhatsAppLocation(
        phone,
        name,
        draft,
        message.location,
        session,
      );
      return true;
    }

    if (message.text) {
      const raw = message.text.trim();
      if (!raw) {
        await sendTextMessage(phone, await cms("P_ASK_PICKUP_TEXT"));
        return true;
      }

      const label = resolvePickupLabelFromText(raw);
      if (!label) {
        await sendTextMessage(phone, await cms("P_ASK_PICKUP_TEXT"));
        return true;
      }

      const nextDraft: BookingDraft = {
        ...draft,
        pickupLabel: label,
        pickup: undefined,
        pickupLocation: undefined,
        originCapture: "label_plus_whatsapp_location",
        route: undefined,
        quote: undefined,
      };
      await startPickupLocationStep(phone, name, {
        pickupLabel: label,
        pendingDropoffText: nextDraft.pendingDropoffText,
      });
      return true;
    }

    await sendTextMessage(phone, await cms("P_ASK_PICKUP_TEXT"));
    return true;
  }

  // --- Paso: ubicación WhatsApp → pickupLocation (punto exacto) ---
  if (session.state === "WAITING_PICKUP_LOCATION") {
    if (message.location) {
      await applyPickupFromWhatsAppLocation(
        phone,
        name,
        draft,
        message.location,
        session,
      );
      return true;
    }

    if (message.text || message.button === BOOKING_BUTTON_IDS.SHARE_HINT) {
      await askForPickupLocation(phone, pickupZoneLabel(draft));
      return true;
    }

    return true;
  }

  // --- Nombre tras ubicación (sin onboarding "¿Cómo te gusta que te llamemos?") ---
  if (session.state === "WAITING_BOOKING_NAME") {
    if (!message.text?.trim()) {
      await sendTextMessage(phone, ASK_BOOKING_NAME);
      return true;
    }
    if (isBlockedBookingName(message.text)) {
      await sendTextMessage(phone, ASK_BOOKING_NAME);
      return true;
    }

    const savedName = await saveBookingPassengerName(phone, message.text);
    await continueAfterPickupCaptured(phone, savedName, draft, {
      ...session,
      name: savedName,
    });
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
      await sendTextMessage(phone, await cms("P_RETRY_DROPOFF_TEXT"));
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
          await cms("P_CANDIDATE_INVALID"),
        );
        return true;
      }
      const resolved = candidateToResolved(chosen);
      const city = await getActiveCity();
      if (!isPointInCity(resolved.location, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        draft.dropoff = undefined;
        draft.candidates = undefined;
        await offerDropoffNotFoundOptions(phone, name, draft);
        return true;
      }
      // Elección en lista → cotización directa (sin mapa ni confirmación extra).
      draft.dropoff = resolved;
      draft.candidates = undefined;
      draft.candidateRole = undefined;
      console.log("[booking] destino elegido de lista → cotización", {
        placeId: resolved.placeId,
        name: resolved.name,
      });
      await afterDropoffConfirmed(phone, name, draft);
      return true;
    }

    await sendTextMessage(
      phone,
      await cms("P_CHOOSE_OR_REWRITE"),
    );
    return true;
  }

  // Confirm de origen vía Places: solo si hay ambigüedad (lista de candidatos).
  if (session.state === "WAITING_PICKUP_CONFIRM") {
    if (message.button === BOOKING_BUTTON_IDS.REJECT_PLACE) {
      await persistDraft(phone, name, "WAITING_PICKUP_TEXT", {
        ...draft,
        pickup: undefined,
        pickupLabel: undefined,
        candidates: undefined,
      });
      await sendTextMessage(phone, await cms("P_ASK_PICKUP_TEXT"));
      return true;
    }

    if (message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE && draft.pickup) {
      const city = await getActiveCity();
      if (!isPointInCity(draft.pickup.location, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        await fallbackPickupToGps(
          phone,
          name,
          draft,
          passengerPickupLabel(draft, draft.pickup.name),
        );
        return true;
      }
      await continueWithResolvedPickup(
        phone,
        name,
        draft,
        draft.pickup,
        passengerPickupLabel(draft, draft.pickup.name),
        session,
      );
      return true;
    }

    if (message.button?.startsWith(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX)) {
      const index = Number(
        message.button.slice(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX.length),
      );
      const chosen = (draft.candidates ?? [])[index];
      if (!chosen) {
        await sendTextMessage(phone, await cms("P_CANDIDATE_INVALID"));
        return true;
      }
      const resolved = candidateToResolved(chosen);
      const city = await getActiveCity();
      if (!isPointInCity(resolved.location, city)) {
        await sendTextMessage(phone, outOfCityServiceMessage(city));
        await fallbackPickupToGps(
          phone,
          name,
          { ...draft, candidates: undefined },
          passengerPickupLabel(draft, chosen.name),
        );
        return true;
      }
      await continueWithResolvedPickup(
        phone,
        name,
        draft,
        resolved,
        passengerPickupLabel(draft, chosen.name),
        session,
      );
      return true;
    }

    await sendTextMessage(phone, await cms("P_CHOOSE_OR_REWRITE"));
    return true;
  }

  return false;
}
