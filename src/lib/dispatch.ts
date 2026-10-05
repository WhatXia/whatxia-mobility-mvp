import { cms } from "@/lib/bot-cms/copy";
import {
  findDriverByPhone,
  getDriverFullName,
  listAvailableDrivers,
  markDriverAvailable,
  markDriverUnavailable,
  type DriverRow,
} from "@/lib/supabase/drivers";
import {
  findOrCreatePassenger,
  passengerNameForDriverAssignment,
} from "@/lib/supabase/passengers";
import {
  createTrip,
  clearSearchDeadlinesOnAssign,
  finishTrip,
  getTrip,
  markDriverArrived,
  resolveDriverTrip,
  setTripEta,
  startSearchCycle,
  startTrip,
  tryAssignTrip,
  type CreateTripGeoInput,
  type Trip,
} from "@/lib/trips";
import { upsertSession } from "@/lib/sessions";
import {
  sendButtonsMessage,
  sendCtaUrlMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";
import { sendRatingPrompt } from "@/lib/rating";
import {
  getDriverRatingAggregate,
  sendDriverRatesPassengerPrompt,
} from "@/lib/reputation";

import {
  cancelServicioButtonId,
  yaVoyButtonId,
} from "@/lib/cancellations";
import {
  listExcludedDriverIdsForTrip,
  filterDriversForTripOffer,
} from "@/lib/trip-exclusions";
import {
  diagnoseTunnelVisibility,
  openTunnel,
  scheduleTunnelClose,
} from "@/lib/tunnels";
import type {
  FareQuote,
  ResolvedPlace,
  RouteEstimate,
} from "@/lib/geo/types";
import { computeAutomaticEtaRange } from "@/lib/eta-auto";
import {
  finalizeFare,
  formatEstimatedFareRangeLine,
} from "@/lib/tariff";
import { formatCopSymbol } from "@/lib/tariff/present-estimate";
import {
  getCityById,
  listEnabledCities,
  outOfCoverageMessage,
  resolveCityFromPoint,
} from "@/lib/city/context";
import { planTripCompletion } from "@/lib/city/pricing";
import {
  filterDriversByTripCity,
} from "@/lib/city/isolation";
import {
  dispatchFleetCity,
  driverServesOriginCity,
} from "@/lib/city/corridors";
import { mapsNavigationUrl } from "@/lib/geo/maps-url";
import {
  formatAssignedPickupBlock,
  formatAssignedPickupParts,
  resolveOfferOrigin,
} from "@/lib/booking/intent";

export type TripOfferDetails = {
  pickup: ResolvedPlace;
  /** Opcional mientras el camino de solicitud no exige destino. */
  dropoff?: ResolvedPlace;
  route?: RouteEstimate;
  quote?: FareQuote;
};
export const DRIVER_BUTTON_IDS = {
  ACEPTAR: "aceptar_servicio",
  RECHAZAR: "rechazar_servicio",
  ETA: "eta",
  LLEGUE: "llegue",
  VER_UBICACION: "ver_ubicacion",
  INICIAR: "iniciar_viaje",
  NAVEGAR: "navegar_destino",
  FINALIZAR: "finalizar_viaje",
} as const;

/** Compat: botones ETA antiguos aún pueden llegar por mensajes previos. */
const ETA_OPTIONS = [5, 7, 10] as const;

type DriverButtonAction =
  | { action: "accept"; tripId: string }
  | { action: "reject"; tripId: string }
  | { action: "eta"; tripId: string; minutes: number }
  | { action: "llegue"; tripId: string }
  | { action: "ver_ubicacion"; tripId: string }
  | { action: "iniciar"; tripId: string }
  | { action: "navegar"; tripId: string }
  | { action: "finalizar"; tripId: string };

function llegueButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.LLEGUE}:${tripId}`;
}

function verUbicacionButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.VER_UBICACION}:${tripId}`;
}

function iniciarButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.INICIAR}:${tripId}`;
}

function navegarButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.NAVEGAR}:${tripId}`;
}

function finalizarButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.FINALIZAR}:${tripId}`;
}

export function parseDriverButton(
  button: string | null,
): DriverButtonAction | null {
  if (!button) {
    return null;
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.ACEPTAR}:`)) {
    return {
      action: "accept",
      tripId: button.slice(DRIVER_BUTTON_IDS.ACEPTAR.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.RECHAZAR}:`)) {
    return {
      action: "reject",
      tripId: button.slice(DRIVER_BUTTON_IDS.RECHAZAR.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.ETA}:`)) {
    const rest = button.slice(DRIVER_BUTTON_IDS.ETA.length + 1);
    const [minutesRaw, ...tripParts] = rest.split(":");
    const minutes = Number(minutesRaw);
    const tripId = tripParts.join(":");

    if (!ETA_OPTIONS.includes(minutes as (typeof ETA_OPTIONS)[number]) || !tripId) {
      return null;
    }

    return { action: "eta", tripId, minutes };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.LLEGUE}:`)) {
    return {
      action: "llegue",
      tripId: button.slice(DRIVER_BUTTON_IDS.LLEGUE.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.VER_UBICACION}:`)) {
    return {
      action: "ver_ubicacion",
      tripId: button.slice(DRIVER_BUTTON_IDS.VER_UBICACION.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.INICIAR}:`)) {
    return {
      action: "iniciar",
      tripId: button.slice(DRIVER_BUTTON_IDS.INICIAR.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.NAVEGAR}:`)) {
    return {
      action: "navegar",
      tripId: button.slice(DRIVER_BUTTON_IDS.NAVEGAR.length + 1),
    };
  }

  if (button.startsWith(`${DRIVER_BUTTON_IDS.FINALIZAR}:`)) {
    return {
      action: "finalizar",
      tripId: button.slice(DRIVER_BUTTON_IDS.FINALIZAR.length + 1),
    };
  }

  return null;
}

/** Rating en el mensaje unificado de asignación (sin cambiar formatters de reputación). */
function formatDriverStarsForAssignment(average: number | null): string {
  if (average == null) {
    // TODO(bot-cms): "⭐ Calificación: Conductor nuevo." — no catalog code
    return "⭐ Calificación: Conductor nuevo.";
  }
  // TODO(bot-cms): rated line uses runtime score — pass as {{rating_line}} var only
  return `⭐ Calificación: ${average.toFixed(1)}`;
}

type PassengerEtaNotice =
  | { kind: "skipped" }
  | { kind: "eta_failed" }
  | {
      kind: "sent";
      trip: Trip;
      elapsedSeconds: number;
      minMinutes: number;
      maxMinutes: number;
    };

/**
 * Persiste el ETA automático y avisa solo al pasajero.
 * El mensaje al conductor queda en el canal que llama.
 */
async function saveAutomaticEtaAndNotifyPassenger(params: {
  trip: Trip;
  driverName: string;
  plate: string;
  driverAverage: number | null;
}): Promise<PassengerEtaNotice> {
  const { trip, driverName, plate, driverAverage } = params;

  if (trip.status !== "ASSIGNED") {
    console.warn("[dispatch] ETA automático omitido: viaje no ASSIGNED", {
      tripId: trip.id,
      status: trip.status,
    });
    return { kind: "skipped" };
  }

  const createdMs = trip.createdAt ? Date.parse(trip.createdAt) : NaN;
  const elapsedSeconds = Number.isFinite(createdMs)
    ? Math.max(0, (Date.now() - createdMs) / 1000)
    : 0;
  const range = computeAutomaticEtaRange(elapsedSeconds);

  const updated = await setTripEta(trip.id, range.maxMinutes);
  if (!updated) {
    return { kind: "eta_failed" };
  }

  const plateLabel = plate.trim() || "Sin placa";
  const passengerBody = await cms("P_VEHICLE_CONFIRMED", {
    driver_name: driverName,
    plate: plateLabel,
    eta_min: String(range.minMinutes),
    eta_max: String(range.maxMinutes),
    rating_line: formatDriverStarsForAssignment(driverAverage),
    tripId: updated.id,
  });

  await sendButtonsMessage(updated.passengerPhone, passengerBody, [
    {
      id: cancelServicioButtonId(updated.id),
      title: "❌ Cancelar servicio",
    },
  ]);

  return {
    kind: "sent",
    trip: updated,
    elapsedSeconds,
    minMinutes: range.minMinutes,
    maxMinutes: range.maxMinutes,
  };
}

async function sendDriverAssignmentNotice(params: {
  driverPhone: string;
  trip: Trip;
  passengerFullName: string;
}): Promise<void> {
  const { driverPhone, trip, passengerFullName } = params;
  const assignedPickup = formatAssignedPickupParts(
    trip.pickupNeighborhood,
    trip.pickupLabel,
  );
  const pickupBlock =
    formatAssignedPickupBlock(trip.pickupNeighborhood, trip.pickupLabel) ||
    trip.pickupLabel?.trim() ||
    trip.pickupNeighborhood?.trim() ||
    "Punto de recogida";
  const driverBody = await cms("D_SERVICE_ASSIGNED", {
    passenger_full_name: passengerFullName,
    passenger_name: passengerFullName,
    pickup_block: pickupBlock,
    pickup_neighborhood: assignedPickup.neighborhood,
    pickup_detail: assignedPickup.detail,
    tripId: trip.id,
  });

  await sendButtonsMessage(driverPhone, driverBody, [
    { id: verUbicacionButtonId(trip.id), title: "📍 Ver ubicación" },
    { id: llegueButtonId(trip.id), title: "🚕 Llegué" },
    {
      id: cancelServicioButtonId(trip.id),
      title: "❌ Cancelar servicio",
    },
  ]);
}

async function sendStartTripButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(
    driverPhone,
    await cms("D_START_TRIP_PROMPT", { tripId }),
    [{ id: iniciarButtonId(tripId), title: "▶️ Iniciar viaje" }],
  );
}

/** Pantalla operativa en viaje: destino + navegar + terminar (sin mapa embebido). */
async function sendInProgressTripScreen(
  driverPhone: string,
  trip: Trip,
): Promise<void> {
  const label = trip.dropoffLabel?.trim() || "Destino";
  await sendButtonsMessage(
    driverPhone,
    await cms("D_IN_PROGRESS_SCREEN", {
      dropoff_label: label,
      tripId: trip.id,
    }),
    [
      { id: navegarButtonId(trip.id), title: "🗺️ Abrir Maps" },
      { id: finalizarButtonId(trip.id), title: "🏁 Terminar viaje" },
    ],
  );
}

export async function offerTripToDrivers(
  passengerPhone: string,
  pickupNeighborhood: string,
  details?: TripOfferDetails,
) {
  console.log("[publish:diag] STEP_1_offerTripToDrivers_enter", {
    passengerPhone,
    pickupNeighborhood,
    hasGeo: Boolean(details),
    quotedFare: details?.quote?.amount ?? null,
    note: "Mapa: requestTrip() → offerTripToDrivers; status trip será SEARCHING (no 'requested')",
    continues: true,
  });
  console.log("[dispatch:diag] STEP_1_start", {
    passengerPhone,
    pickupNeighborhood,
    hasGeo: Boolean(details),
  });


  const requesterDriver = await findDriverByPhone(passengerPhone);
  console.log("[dispatch:diag] STEP_2_requesterDriver", {
    found: Boolean(requesterDriver),
    requesterDriverId: requesterDriver?.id ?? null,
  });

  const pickupPoint = details?.pickup?.location;
  if (
    pickupPoint == null ||
    !Number.isFinite(pickupPoint.lat) ||
    !Number.isFinite(pickupPoint.lng)
  ) {
    console.error("[dispatch] STOP_at_missing_pickup_coords", {
      passengerPhone,
      note: "Sin pickup no se resuelve trip.city_id",
    });
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(passengerPhone, "", {
      body: outOfCoverageMessage(),
    });
    return;
  }

  const serviceCity = await resolveCityFromPoint(pickupPoint);
  if (!serviceCity) {
    console.warn("[dispatch] STOP_at_pickup_outside_enabled_city", {
      passengerPhone,
      pickup: pickupPoint,
    });
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(passengerPhone, "", {
      body: outOfCoverageMessage(),
    });
    return;
  }

  const cities = await listEnabledCities();
  const fleetCity = dispatchFleetCity(serviceCity, cities);

  let availableDrivers;
  try {
    availableDrivers = await listAvailableDrivers({
      cityId: fleetCity.id,
      excludePhone: passengerPhone,
      excludeDriverId: requesterDriver?.id,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_listAvailableDrivers", {
      error,
      hint: "Posible columna faltante (suspended_until / cancel_policy_count) si migración 010 no aplicada",
    });
    throw error;
  }

  console.log("[dispatch:diag] STEP_3_eligible_count", {
    originCityId: serviceCity.id,
    originCitySlug: serviceCity.slug,
    fleetCityId: fleetCity.id,
    fleetCitySlug: fleetCity.slug,
    count: availableDrivers.length,
    drivers: availableDrivers.map((d) => ({
      id: d.id,
      phone: d.phone,
      is_available: d.is_available,
      status: d.status,
      documents_blocked: d.documents_blocked,
      suspended_until: d.suspended_until ?? null,
      cancel_policy_count: d.cancel_policy_count ?? null,
    })),
  });

  if (availableDrivers.length === 0) {
    console.warn("[dispatch:diag] STOP_at_zero_eligible_before_createTrip", {
      reason: "listAvailableDrivers devolvió 0 tras filtros excludePhone/excludeDriverId/suspensión",
    });
    console.warn("[dispatch] no hay conductores disponibles");
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(passengerPhone, "", {
      body: await cms("P_NO_DRIVERS_AT_PUBLISH"),
    });
    return;
  }

  let passenger;
  try {
    passenger = await findOrCreatePassenger(passengerPhone);
    console.log("[dispatch:diag] STEP_4_passenger", {
      passengerId: passenger.id,
      no_show_count: passenger.no_show_count ?? null,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_findOrCreatePassenger", {
      error,
      hint: "Posible columna faltante passengers.no_show_count (migración 010)",
    });
    throw error;
  }

  const geo: CreateTripGeoInput | undefined = details
    ? {
        pickupLat: details.pickup.location.lat,
        pickupLng: details.pickup.location.lng,
        pickupPlaceId: details.pickup.placeId,
        pickupLabel: details.pickup.name || details.pickup.address,
        ...(details.dropoff
          ? {
              dropoffLat: details.dropoff.location.lat,
              dropoffLng: details.dropoff.location.lng,
              dropoffPlaceId: details.dropoff.placeId,
              dropoffLabel: details.dropoff.name || details.dropoff.address,
            }
          : {}),
        ...(details.route
          ? {
              distanceMeters: details.route.distanceMeters,
              durationSeconds: details.route.durationSeconds,
            }
          : {}),
        ...(details.quote
          ? {
              quotedFare: details.quote.amount,
              currency: details.quote.currency,
            }
          : {}),
      }
    : undefined;

  let trip;
  try {
    trip = await createTrip(
      passengerPhone,
      pickupNeighborhood,
      passenger.id,
      geo,
    );
    console.log("[dispatch:diag] STEP_5_trip_created", {
      tripId: trip.id,
      cityId: trip.cityId,
      citySlug: serviceCity.slug,
      fleetCityId: fleetCity.id,
      fleetCitySlug: fleetCity.slug,
      status: trip.status,
      searchDeadlineAt: trip.searchDeadlineAt ?? null,
      quotedFare: trip.quotedFare,
    });
    console.log("[publish:diag] STEP_5_trip_created", {
      tripId: trip.id,
      status: trip.status,
      expectedStatus: "SEARCHING",
      statusOk: trip.status === "SEARCHING",
      passengerId: trip.passengerId,
      quotedFare: trip.quotedFare,
      continues: true,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_createTrip", {
      error,
      hint: "Posibles columnas faltantes search_* (011) o geo/fare (014)",
    });
    console.error("[publish:diag] STOP_at_createTrip", {
      continues: false,
      error,
    });
    throw error;
  }

  console.log("[dispatch:diag] STEP_6_calling_publishTripOffer", {
    tripId: trip.id,
  });
  console.log("[publish:diag] STEP_6_publishTripOffer_enter", {
    tripId: trip.id,
    note: "Equivale a DispatchEngine.publishOffer()",
    continues: true,
  });

  await publishTripOffer(trip, {
    excludePhone: passengerPhone,
    excludeDriverId: requesterDriver?.id,
  });

  console.log("[dispatch:diag] STEP_7_publishTripOffer_returned", {
    tripId: trip.id,
  });
  console.log("[publish:diag] STEP_7_offerTripToDrivers_done", {
    tripId: trip.id,
    continues: true,
  });
}

/**
 * Republica un viaje ya en SEARCHING (reasignación o “seguir buscando”).
 * Respeta exclusiones persistidas por trip_id (conductores que cancelaron ese viaje).
 */
export async function republishTripToDrivers(tripId: string): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || trip.status !== "SEARCHING") {
    console.warn("[dispatch] republish ignorado", {
      tripId,
      status: trip?.status ?? null,
    });
    return;
  }

  console.log("[dispatch] republish", {
    tripId: trip.id,
    cityId: trip.cityId,
    status: trip.status,
  });

  await startSearchCycle(trip.id);

  await publishTripOffer(trip, {
    excludePhone: trip.passengerPhone,
  });
}

export type TripOfferAudienceOptions = {
  excludePhone?: string;
  excludeDriverId?: string;
  /**
   * La consulta de la app reutiliza esta selección sin repetir
   * los logs de diagnóstico del envío por WhatsApp.
   */
  quiet?: boolean;
};

export type TripOfferAudience = {
  drivers: DriverRow[];
  excludedDriverIds: string[];
};

/**
 * Conductores que recibirían la oferta de este viaje.
 * Misma selección que el envío por WhatsApp: flota de la ciudad,
 * listAvailableDrivers, ciudad operacional y exclusiones del viaje.
 */
export async function listEligibleDriversForTripOffer(
  trip: Trip,
  options?: TripOfferAudienceOptions,
): Promise<TripOfferAudience> {
  const quiet = options?.quiet === true;

  let tripExclusions: string[] = [];
  try {
    tripExclusions = await listExcludedDriverIdsForTrip(trip.id);
    if (!quiet) {
      console.log("[dispatch:diag] publish_STEP_B_exclusions", {
        tripId: trip.id,
        tripExclusions,
      });
    }
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_listExcludedDriverIdsForTrip", {
      tripId: trip.id,
      error,
      hint: "Tabla trip_driver_exclusions inexistente si migración 012 no aplicada → aquí se corta el despacho",
    });
    throw error;
  }

  const excludedDriverIds = Array.from(
    new Set([
      ...tripExclusions,
      ...(options?.excludeDriverId ? [options.excludeDriverId] : []),
    ]),
  );

  if (!trip.cityId) {
    console.error("[dispatch] STOP_at_publish_missing_trip_city", {
      tripId: trip.id,
    });
    return { drivers: [], excludedDriverIds };
  }

  const originCity = await getCityById(trip.cityId);
  if (!originCity) {
    console.error("[dispatch] STOP_at_publish_unknown_trip_city", {
      tripId: trip.id,
      tripCityId: trip.cityId,
    });
    return { drivers: [], excludedDriverIds };
  }
  const cities = await listEnabledCities();
  const fleetCity = dispatchFleetCity(originCity, cities);

  let candidates: DriverRow[];
  try {
    candidates = await listAvailableDrivers({
      cityId: fleetCity.id,
      excludePhone: options?.excludePhone,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_publish_listAvailableDrivers", {
      tripId: trip.id,
      error,
    });
    throw error;
  }

  if (!quiet) {
    console.log("[dispatch:diag] publish_STEP_C_candidates", {
      tripId: trip.id,
      candidateCount: candidates.length,
      excludedDriverIds,
      candidateIds: candidates.map((d) => d.id),
    });
  }

  const availableDrivers = filterDriversForTripOffer({
    drivers: filterDriversByTripCity(candidates, fleetCity.id),
    excludedDriverIds,
  });

  if (!quiet) {
    console.log("[dispatch:diag] publish_STEP_D_after_exclusion_filter", {
      tripId: trip.id,
      eligibleCount: availableDrivers.length,
      eligibleIds: availableDrivers.map((d) => d.id),
    });
  }

  if (availableDrivers.length === 0 && !quiet) {
    console.warn("[dispatch:diag] STOP_at_zero_eligible_after_filters", {
      tripId: trip.id,
      excludedDriverIds,
      candidateCount: candidates.length,
      reason: "Todos los candidatos fueron filtrados (exclusiones / teléfono)",
    });
    console.warn("[dispatch] oferta sin conductores elegibles", {
      tripId: trip.id,
      excludedDriverIds,
    });
  }

  return { drivers: availableDrivers, excludedDriverIds };
}

async function publishTripOffer(
  trip: Trip,
  options?: { excludePhone?: string; excludeDriverId?: string },
): Promise<void> {
  console.log("[dispatch:diag] publish_STEP_A_start", { tripId: trip.id });

  const audience = await listEligibleDriversForTripOffer(trip, options);

  console.log("[dispatch] oferta disponible para Driver App, sin WhatsApp", {
    tripId: trip.id,
    status: trip.status,
    eligibleCount: audience.drivers.length,
  });
}

export type DriverAcceptTripView = {
  trip_id: string;
  status: Trip["status"];
  driver_id: string;
  pickup_label: string;
  dropoff_label: string | null;
  quoted_fare: number | null;
  eta_minutes: number | null;
};

export type DriverAppAcceptFailureReason =
  | "TRIP_NOT_FOUND"
  | "ALREADY_TAKEN"
  | "DRIVER_NOT_FOUND"
  | "DRIVER_NOT_AVAILABLE"
  | "DRIVER_NOT_ELIGIBLE"
  | "ETA_NOT_SAVED";

export type DriverAppAcceptResult =
  | { ok: true; reason: "ASSIGNED"; trip: DriverAcceptTripView }
  | { ok: false; reason: DriverAppAcceptFailureReason };

type AcceptContext =
  | {
      ok: false;
      reason: Exclude<DriverAppAcceptFailureReason, "ETA_NOT_SAVED">;
    }
  | { ok: true; trip: Trip; driver: DriverRow };

type CommittedAssignment =
  | { ok: false; reason: "ALREADY_TAKEN" }
  | {
      ok: true;
      assigned: Trip;
      etaTrip: Trip | null;
      openedTunnelId: string | null;
      passengerFullName: string;
      passengerNotified: boolean;
      etaFailed: boolean;
      elapsedSeconds: number;
      minMinutes: number;
      maxMinutes: number;
    };

function driverAcceptTripView(trip: Trip, driverId: string): DriverAcceptTripView {
  const dropoff = trip.dropoffLabel?.trim() ?? "";
  return {
    trip_id: trip.id,
    status: trip.status,
    driver_id: driverId,
    pickup_label: resolveOfferOrigin(trip.pickupNeighborhood, trip.pickupLabel),
    dropoff_label: dropoff.length > 0 ? dropoff : null,
    quoted_fare: trip.quotedFare,
    eta_minutes: trip.etaMinutes,
  };
}

async function loadAcceptContext(
  driverPhone: string,
  tripId: string,
): Promise<AcceptContext> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return { ok: false, reason: "TRIP_NOT_FOUND" };
  }
  if (trip.status !== "SEARCHING") {
    return { ok: false, reason: "ALREADY_TAKEN" };
  }

  const driver = await findDriverByPhone(driverPhone);
  if (!driver) {
    return { ok: false, reason: "DRIVER_NOT_FOUND" };
  }
  if (!driver.is_available) {
    return { ok: false, reason: "DRIVER_NOT_AVAILABLE" };
  }

  const originCity = trip.cityId ? await getCityById(trip.cityId) : null;
  const driverCity = driver.city_id ? await getCityById(driver.city_id) : null;
  if (
    !originCity ||
    !driverCity ||
    !driverServesOriginCity(originCity, driverCity)
  ) {
    console.warn("[dispatch] accept rejected cross-city", {
      tripId: trip.id,
      tripCityId: trip.cityId,
      tripCitySlug: originCity?.slug ?? null,
      driverId: driver.id,
      driverCityId: driver.city_id,
      driverCitySlug: driverCity?.slug ?? null,
    });
    return { ok: false, reason: "DRIVER_NOT_ELIGIBLE" };
  }

  return { ok: true, trip, driver };
}

/**
 * Asignación común: viaje, conductor, sesión del pasajero, plazos, túnel,
 * ETA y WhatsApp del pasajero. No escribe al conductor.
 */
async function commitDriverAssignment(params: {
  driverPhone: string;
  tripId: string;
  driver: DriverRow;
}): Promise<CommittedAssignment> {
  const { driverPhone, tripId, driver } = params;

  // El teléfono de esta llamada queda en el viaje para ETA / Llegué / Iniciar / Finalizar.
  const assigned = await tryAssignTrip(
    tripId,
    driver.id,
    driverPhone,
    getDriverFullName(driver),
  );

  if (!assigned) {
    return { ok: false, reason: "ALREADY_TAKEN" };
  }

  await markDriverUnavailable(driver.id);

  await upsertSession(assigned.passengerPhone, {
    state: "ASSIGNED",
  });

  await clearSearchDeadlinesOnAssign(assigned.id);

  let openedTunnelId: string | null = null;

  console.log("[dispatch:accept:tunnel:before_open]", {
    trip_id: assigned.id,
    passenger_phone: assigned.passengerPhone,
    driver_phone: driverPhone,
  });

  try {
    const tunnel = await openTunnel({
      tripId: assigned.id,
      passengerPhone: assigned.passengerPhone,
      driverPhone,
    });
    openedTunnelId = tunnel.id;
    console.log("[dispatch:accept:tunnel:after_open]", {
      trip_id: assigned.id,
      passenger_phone: assigned.passengerPhone,
      driver_phone: driverPhone,
      tunnel_id: tunnel.id,
      status: tunnel.status,
    });
  } catch (error) {
    // Si faltan migraciones 007–009 en Supabase, el viaje sigue; el túnel no.
    console.error("[dispatch:accept:tunnel:open_threw]", {
      trip_id: assigned.id,
      passenger_phone: assigned.passengerPhone,
      driver_phone: driverPhone,
      error,
      supabase_error:
        error && typeof error === "object"
          ? {
              message: (error as { message?: string }).message,
              code: (error as { code?: string }).code,
              details: (error as { details?: string }).details,
              hint: (error as { hint?: string }).hint,
            }
          : null,
    });
  }

  const driverRep = await getDriverRatingAggregate(driver.id);
  const passenger = await findOrCreatePassenger(assigned.passengerPhone);
  const passengerFullName = passengerNameForDriverAssignment(passenger, {
    pickupLabel: assigned.pickupLabel,
  });
  const notice = await saveAutomaticEtaAndNotifyPassenger({
    trip: assigned,
    driverName: getDriverFullName(driver),
    plate: driver.plate ?? "",
    driverAverage: driverRep.average,
  });

  return {
    ok: true,
    assigned,
    etaTrip: notice.kind === "sent" ? notice.trip : null,
    openedTunnelId,
    passengerFullName,
    passengerNotified: notice.kind === "sent",
    etaFailed: notice.kind === "eta_failed",
    elapsedSeconds: notice.kind === "sent" ? notice.elapsedSeconds : 0,
    minMinutes: notice.kind === "sent" ? notice.minMinutes : 0,
    maxMinutes: notice.kind === "sent" ? notice.maxMinutes : 0,
  };
}

async function finishAcceptDiagnostics(params: {
  driverPhone: string;
  driverId: string;
  assigned: Trip;
  openedTunnelId: string | null;
}): Promise<void> {
  const { driverPhone, driverId, assigned, openedTunnelId } = params;
  await diagnoseTunnelVisibility({
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverPhone,
    expectedTunnelId: openedTunnelId,
    phase: "after_passenger_assignment_message",
  });

  console.log("[dispatch] viaje asignado:", {
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverId,
    driverPhone,
    assignedDriverPhone: assigned.assignedDriverPhone,
  });
}

export async function handleDriverAccept(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const context = await loadAcceptContext(driverPhone, tripId);
  if (!context.ok) {
    if (
      context.reason === "TRIP_NOT_FOUND" ||
      context.reason === "ALREADY_TAKEN"
    ) {
      await sendTextMessage(driverPhone, await cms("D_TRIP_ALREADY_TAKEN"));
      return;
    }
    if (context.reason === "DRIVER_NOT_FOUND") {
      await sendTextMessage(driverPhone, await cms("D_NOT_REGISTERED"));
      return;
    }
    await sendTextMessage(driverPhone, await cms("D_NOT_AVAILABLE"));
    return;
  }

  const committed = await commitDriverAssignment({
    driverPhone,
    tripId,
    driver: context.driver,
  });

  if (!committed.ok) {
    await sendTextMessage(driverPhone, await cms("D_TRIP_ALREADY_TAKEN"));
    return;
  }

  if (committed.etaFailed) {
    await sendTextMessage(driverPhone, await cms("D_ETA_REGISTER_FAIL"));
  } else if (committed.passengerNotified && committed.etaTrip) {
    await sendDriverAssignmentNotice({
      driverPhone,
      trip: committed.etaTrip,
      passengerFullName: committed.passengerFullName,
    });
    console.log("[dispatch] asignación unificada + ETA automático:", {
      tripId: committed.etaTrip.id,
      elapsedSeconds: Math.round(committed.elapsedSeconds),
      minMinutes: committed.minMinutes,
      maxMinutes: committed.maxMinutes,
      driverPhone,
    });
  }

  await finishAcceptDiagnostics({
    driverPhone,
    driverId: context.driver.id,
    assigned: committed.assigned,
    openedTunnelId: committed.openedTunnelId,
  });
}

/**
 * Aceptación desde WhatXia Driver. Misma asignación que WhatsApp,
 * sin ningún mensaje al conductor.
 */
export async function handleDriverAppAccept(
  driverPhone: string,
  tripId: string,
): Promise<DriverAppAcceptResult> {
  const context = await loadAcceptContext(driverPhone, tripId);
  if (!context.ok) {
    return context;
  }

  const committed = await commitDriverAssignment({
    driverPhone,
    tripId,
    driver: context.driver,
  });

  if (!committed.ok) {
    return committed;
  }

  await finishAcceptDiagnostics({
    driverPhone,
    driverId: context.driver.id,
    assigned: committed.assigned,
    openedTunnelId: committed.openedTunnelId,
  });

  if (!committed.passengerNotified || !committed.etaTrip) {
    return { ok: false, reason: "ETA_NOT_SAVED" };
  }

  return {
    ok: true,
    reason: "ASSIGNED",
    trip: driverAcceptTripView(committed.etaTrip, context.driver.id),
  };
}

export async function handleDriverReject(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    return;
  }

  console.log("[dispatch] conductor rechazó:", { tripId, driverPhone });
  const driver = await findDriverByPhone(driverPhone);
  if (driver) {
    const { sendDriverMainMenu } = await import("@/lib/driver-menu");
    await sendDriverMainMenu(driver, driverPhone, {
      body: await cms("D_REJECTED"),
    });
  } else {
    await sendTextMessage(driverPhone, await cms("D_REJECTED"));
  }
}

export async function handleDriverEta(
  driverPhone: string,
  tripId: string,
  minutes: number,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] ETA sin viaje activo", { tripId, driverPhone, source });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "ASSIGNED") {
    await sendTextMessage(driverPhone, await cms("D_ETA_ALREADY_SET"));
    return;
  }

  const updated = await setTripEta(trip.id, minutes);

  if (!updated) {
    await sendTextMessage(driverPhone, await cms("D_ETA_REGISTER_FAIL"));
    return;
  }

  const driverName = updated.assignedDriverName ?? "tu conductor";

  await sendButtonsMessage(
    updated.passengerPhone,
    await cms("P_ETA_MANUAL", {
      driver_name: driverName,
      minutes: String(minutes),
      tripId: updated.id,
    }),
    [
      {
        id: cancelServicioButtonId(updated.id),
        title: "❌ Cancelar servicio",
      },
    ],
  );

  // Sin mensaje extra al conductor: D_SERVICE_ASSIGNED ya trae Ver ubicación / Llegué.

  console.log("[dispatch] ETA informado:", {
    tripId: updated.id,
    minutes,
    driverPhone,
    resolveSource: source,
  });
}

/**
 * Abre Google Maps hacia el punto de recogida (coords ya almacenadas).
 * Disponible tras informar ETA, junto a Llegué / Cancelar.
 */
export async function handleDriverVerUbicacion(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] Ver ubicación sin viaje activo", {
      tripId,
      driverPhone,
      source,
    });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "ETA_INFORMED" && trip.status !== "DRIVER_ARRIVED") {
    await sendTextMessage(driverPhone, await cms("D_PICKUP_NAV_UNAVAILABLE"));
    return;
  }

  const label =
    trip.pickupLabel?.trim() ||
    trip.pickupNeighborhood?.trim() ||
    "Punto de recogida";

  const url = mapsNavigationUrl({
    lat: trip.pickupLat,
    lng: trip.pickupLng,
    placeId: trip.pickupPlaceId,
    label,
  });

  if (!url) {
    await sendTextMessage(driverPhone, await cms("D_NO_PICKUP_COORDS"));
    return;
  }

  // WhatsApp no mezcla reply buttons con cta_url. El botón "Ver ubicación"
  // no puede abrir Maps en el mismo mensaje de asignado (Llegué / Cancelar).
  await sendCtaUrlMessage(
    driverPhone,
    await cms("D_PICKUP_MAPS_CTA", { label }),
    {
    displayText: "Abrir Google Maps",
    url,
  });

  console.log("[dispatch] ubicación de recogida enviada al conductor:", {
    tripId: trip.id,
    driverPhone,
    resolveSource: source,
  });
}

export async function handleDriverLlegue(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] Llegué sin viaje activo", { tripId, driverPhone, source });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "ETA_INFORMED") {
    await sendTextMessage(
      driverPhone,
      trip.status === "DRIVER_ARRIVED" || trip.status === "IN_PROGRESS"
        ? await cms("D_ARRIVAL_ALREADY")
        : await cms("D_ARRIVAL_NEED_ETA"),
    );
    return;
  }

  const updated = await markDriverArrived(trip.id);

  if (!updated) {
    await sendTextMessage(driverPhone, await cms("D_ARRIVAL_REGISTER_FAIL"));
    return;
  }

  // UX-003: mensaje de llegada personalizado (solo copy; mismos botones).
  const passenger = await findOrCreatePassenger(updated.passengerPhone);
  const preferred = passenger.preferred_name?.trim();
  const assignedDriver = updated.assignedDriverPhone
    ? await findDriverByPhone(updated.assignedDriverPhone)
    : null;
  const plate = assignedDriver?.plate?.trim() || "Sin placa";
  const arrivalBody = preferred
    ? await cms("P_DRIVER_ARRIVED", {
        preferred,
        plate,
        tripId: updated.id,
      })
    : await cms("P_DRIVER_ARRIVED_ANON", {
        plate,
        tripId: updated.id,
      });

  await sendButtonsMessage(updated.passengerPhone, arrivalBody, [
      { id: yaVoyButtonId(updated.id), title: "✅ Ya voy" },
      {
        id: cancelServicioButtonId(updated.id),
        title: "❌ Cancelar servicio",
      },
    ],
  );

  // Siguiente acción operativa (sin confirmación al conductor).
  await sendStartTripButton(driverPhone, updated.id);

  console.log("[dispatch] conductor llegó al punto de recogida:", {
    tripId: updated.id,
    driverPhone,
    resolveSource: source,
  });
}

export async function handleDriverIniciarViaje(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] Iniciar sin viaje activo", { tripId, driverPhone, source });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "DRIVER_ARRIVED") {
    await sendTextMessage(
      driverPhone,
      trip.status === "IN_PROGRESS" || trip.status === "COMPLETED"
        ? await cms("D_TRIP_ALREADY_STARTED")
        : await cms("D_NEED_ARRIVAL"),
    );
    return;
  }

  const updated = await startTrip(trip.id);

  if (!updated) {
    await sendTextMessage(driverPhone, await cms("D_START_FAIL"));
    return;
  }

  // Pantalla operativa: destino + navegar + terminar (sin mapa ni textos técnicos).
  // UX-001: no notificar al pasajero al iniciar (mensaje vacío de valor).
  await sendInProgressTripScreen(driverPhone, updated);

  console.log("[dispatch] viaje iniciado:", {
    tripId: updated.id,
    driverPhone,
    resolveSource: source,
    dropoffLat: updated.dropoffLat,
    dropoffLng: updated.dropoffLng,
  });
}

export async function handleDriverNavegarDestino(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] Navegar sin viaje activo", {
      tripId,
      driverPhone,
      source,
    });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "IN_PROGRESS") {
    await sendTextMessage(driverPhone, await cms("D_NAV_ONLY_IN_PROGRESS"));
    return;
  }

  const label = trip.dropoffLabel?.trim() || "Destino";
  const url = mapsNavigationUrl({
    lat: trip.dropoffLat,
    lng: trip.dropoffLng,
    placeId: trip.dropoffPlaceId,
    label,
  });

  if (!url) {
    await sendTextMessage(driverPhone, await cms("D_NO_DROPOFF_COORDS"));
    return;
  }

  // WhatsApp no mezcla reply buttons con cta_url. "Abrir Maps" no
  // puede abrir Maps en el mismo mensaje de viaje iniciado (Terminar viaje).
  await sendCtaUrlMessage(
    driverPhone,
    await cms("D_DROPOFF_MAPS_CTA", { label }),
    {
    displayText: "Abrir Google Maps",
    url,
  });

  console.log("[dispatch] navegación enviada al conductor:", {
    tripId: trip.id,
    driverPhone,
    resolveSource: source,
  });
}

export async function handleDriverFinalizarViaje(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] Finalizar sin viaje activo", {
      tripId,
      driverPhone,
      source,
    });
    await sendTextMessage(driverPhone, await cms("D_NO_ACTIVE_SERVICE"));
    return;
  }

  if (trip.status !== "IN_PROGRESS") {
    console.warn("[dispatch] Finalizar con estado inesperado", {
      tripId: trip.id,
      driverPhone,
      statusFound: trip.status,
      resolveSource: source,
    });
    await sendTextMessage(
      driverPhone,
      trip.status === "COMPLETED"
        ? await cms("D_ALREADY_FINISHED")
        : await cms("D_NEED_START"),
    );
    return;
  }

  // Ciudad operacional decide FARE vs NO_FARE. El Tariff Engine no se invoca en NO_FARE.
  let fareCity = trip.cityId ? await getCityById(trip.cityId) : null;
  if (!fareCity && trip.pickupLat != null && trip.pickupLng != null) {
    fareCity = await resolveCityFromPoint({
      lat: trip.pickupLat,
      lng: trip.pickupLng,
    });
  }
  if (!fareCity) {
    console.error("[dispatch] finalizar sin ciudad operacional", {
      tripId: trip.id,
      tripCityId: trip.cityId,
    });
    await sendTextMessage(driverPhone, await cms("D_FINAL_FARE_ERROR"));
    return;
  }

  const completion = planTripCompletion(fareCity.slug);
  const finishedAt = new Date();
  let finalQuote: Awaited<ReturnType<typeof finalizeFare>> | null = null;

  if (completion.runFinalizeFare) {
    const startedAt = trip.startedAt
      ? new Date(trip.startedAt)
      : finishedAt;
    const distanceMeters = trip.distanceMeters ?? 0;
    const durationSeconds =
      trip.durationSeconds ??
      Math.max(
        1,
        Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
      );

    try {
      finalQuote = await finalizeFare({
        citySlug: fareCity.slug,
        origin:
          trip.pickupLat != null && trip.pickupLng != null
            ? {
                lat: trip.pickupLat,
                lng: trip.pickupLng,
                label: trip.pickupLabel ?? trip.pickupNeighborhood,
              }
            : undefined,
        destination:
          trip.dropoffLat != null && trip.dropoffLng != null
            ? {
                lat: trip.dropoffLat,
                lng: trip.dropoffLng,
                label: trip.dropoffLabel ?? undefined,
              }
            : undefined,
        distanceMeters,
        durationSeconds,
        startedAt,
        finishedAt,
        deriveWaitFromSpeed: true,
      });
    } catch (error) {
      console.error("[dispatch] Tariff Engine finalizeFare error:", error);
      await sendTextMessage(driverPhone, await cms("D_FINAL_FARE_ERROR"));
      return;
    }
  }

  const updated = await finishTrip(trip.id, {
    finishedAt: finishedAt.toISOString(),
    ...(completion.persistFinalFare && finalQuote
      ? {
          finalFare: finalQuote.amount,
          waitSeconds: finalQuote.breakdown.waitSecondsUsed,
        }
      : {}),
  });

  if (!updated) {
    await sendTextMessage(driverPhone, await cms("D_FINISH_FAIL"));
    return;
  }

  if (updated.assignedDriverId) {
    await markDriverAvailable(updated.assignedDriverId);
  }

  // REF-004: primera conversión (viaje completado) del pasajero referido.
  if (updated.passengerId) {
    try {
      const { recordReferralConversionIfFirstCompletedTrip } = await import(
        "@/lib/referrals"
      );
      await recordReferralConversionIfFirstCompletedTrip(updated.passengerId);
    } catch (error) {
      console.error("[referrals] conversion hook:", error);
    }
  }

  await upsertSession(updated.passengerPhone, {
    state: "IDLE",
  });

  const completedBody =
    completion.runFinalizeFare && finalQuote
      ? await cms("P_TRIP_COMPLETED", {
          final_fare: formatCopSymbol(finalQuote.amount),
        })
      : await cms("P_TRIP_COMPLETED_NO_FARE");
  await sendRatingPrompt(updated.passengerPhone, updated.id, completedBody);
  await sendDriverRatesPassengerPrompt(driverPhone, updated.id);

  // active → closing + closes_at = now + 5 min
  try {
    await scheduleTunnelClose(updated.id);
  } catch (error) {
    console.error("[dispatch] no se pudo programar cierre de túnel:", error);
  }

  console.log("[dispatch] viaje finalizado:", {
    tripId: updated.id,
    driverPhone,
    driverId: updated.assignedDriverId,
    resolveSource: source,
    pricingMode: completion.pricingMode,
    finalFare: finalQuote?.amount ?? null,
    quotedFare: trip.quotedFare,
    waitSeconds: finalQuote?.breakdown.waitSecondsUsed ?? null,
  });
}
