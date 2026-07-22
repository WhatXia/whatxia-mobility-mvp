import {
  findDriverByPhone,
  listAvailableDrivers,
  markDriverAvailable,
  markDriverUnavailable,
} from "@/lib/supabase/drivers";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
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
  sendLocationMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";
import { sendRatingPrompt } from "@/lib/rating";
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
import { formatFareCop } from "@/lib/pricing/engine";
import { mapsUrlForCoords, mapsUrlForPlaceId } from "@/lib/geo/maps-url";

export type TripOfferDetails = {
  pickup: ResolvedPlace;
  dropoff: ResolvedPlace;
  route: RouteEstimate;
  quote: FareQuote;
};
export const DRIVER_BUTTON_IDS = {
  ACEPTAR: "aceptar_servicio",
  RECHAZAR: "rechazar_servicio",
  ETA: "eta",
  LLEGUE: "llegue",
  INICIAR: "iniciar_viaje",
  FINALIZAR: "finalizar_viaje",
} as const;

const ETA_OPTIONS = [5, 7, 10] as const;

type DriverButtonAction =
  | { action: "accept"; tripId: string }
  | { action: "reject"; tripId: string }
  | { action: "eta"; tripId: string; minutes: number }
  | { action: "llegue"; tripId: string }
  | { action: "iniciar"; tripId: string }
  | { action: "finalizar"; tripId: string };

function acceptButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.ACEPTAR}:${tripId}`;
}

function rejectButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.RECHAZAR}:${tripId}`;
}

function etaButtonId(minutes: number, tripId: string) {
  return `${DRIVER_BUTTON_IDS.ETA}:${minutes}:${tripId}`;
}

function llegueButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.LLEGUE}:${tripId}`;
}

function iniciarButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.INICIAR}:${tripId}`;
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

  if (button.startsWith(`${DRIVER_BUTTON_IDS.INICIAR}:`)) {
    return {
      action: "iniciar",
      tripId: button.slice(DRIVER_BUTTON_IDS.INICIAR.length + 1),
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

async function sendEtaOptions(driverPhone: string, tripId: string) {
  // Títulos ≤ 20 caracteres (límite WhatsApp).
  await sendButtonsMessage(
    driverPhone,
    "¿En cuánto tiempo llegas al punto de recogida?",
    [
      { id: etaButtonId(5, tripId), title: "⏱️ Llego en 5 min" },
      { id: etaButtonId(7, tripId), title: "⏱️ Llego en 7 min" },
      { id: etaButtonId(10, tripId), title: "⏱️ Llego en 10 min" },
    ],
  );
}

async function sendArrivedButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(driverPhone, "Cuando llegues al punto de recogida:", [
    { id: llegueButtonId(tripId), title: "📍 Llegué" },
    { id: cancelServicioButtonId(tripId), title: "❌ Cancelar servicio" },
  ]);
}

async function sendStartTripButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(driverPhone, "Cuando el pasajero suba:", [
    { id: iniciarButtonId(tripId), title: "▶️ Iniciar viaje" },
  ]);
}

async function sendFinishTripButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(driverPhone, "🏁 Al llegar a tu destino:", [
    { id: finalizarButtonId(tripId), title: "Termina tu viaje" },
  ]);
}

/** Destino al iniciar viaje: pin WA o enlace Google Maps (sin texto extra). */
async function sendDropoffLocationToDriver(
  driverPhone: string,
  trip: Trip,
): Promise<void> {
  const label = trip.dropoffLabel?.trim() || "Destino";

  if (trip.dropoffLat != null && trip.dropoffLng != null) {
    await sendLocationMessage(driverPhone, {
      latitude: trip.dropoffLat,
      longitude: trip.dropoffLng,
      name: label,
      address: label,
    });
    return;
  }

  if (trip.dropoffPlaceId) {
    await sendTextMessage(
      driverPhone,
      mapsUrlForPlaceId(trip.dropoffPlaceId, label),
    );
    return;
  }

  if (trip.dropoffLabel) {
    await sendTextMessage(
      driverPhone,
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.dropoffLabel)}`,
    );
  }
}

export async function offerTripToDrivers(
  passengerPhone: string,
  pickupNeighborhood: string,
  details?: TripOfferDetails,
) {
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

  let availableDrivers;
  try {
    availableDrivers = await listAvailableDrivers({
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
    await sendTextMessage(
      passengerPhone,
      "Por ahora no hay conductores disponibles. Intenta de nuevo en un momento.",
    );
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
        dropoffLat: details.dropoff.location.lat,
        dropoffLng: details.dropoff.location.lng,
        dropoffPlaceId: details.dropoff.placeId,
        dropoffLabel: details.dropoff.name || details.dropoff.address,
        distanceMeters: details.route.distanceMeters,
        durationSeconds: details.route.durationSeconds,
        quotedFare: details.quote.amount,
        currency: details.quote.currency,
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
      status: trip.status,
      searchDeadlineAt: trip.searchDeadlineAt ?? null,
      quotedFare: trip.quotedFare,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_createTrip", {
      error,
      hint: "Posibles columnas faltantes search_* (011) o geo/fare (014)",
    });
    throw error;
  }

  console.log("[dispatch:diag] STEP_6_calling_publishTripOffer", {
    tripId: trip.id,
  });

  await publishTripOffer(trip, {
    excludePhone: passengerPhone,
    excludeDriverId: requesterDriver?.id,
  });

  console.log("[dispatch:diag] STEP_7_publishTripOffer_returned", {
    tripId: trip.id,
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

  await startSearchCycle(trip.id);

  await publishTripOffer(trip, {
    excludePhone: trip.passengerPhone,
  });
}

async function publishTripOffer(
  trip: Trip,
  options?: { excludePhone?: string; excludeDriverId?: string },
): Promise<void> {
  console.log("[dispatch:diag] publish_STEP_A_start", { tripId: trip.id });

  let tripExclusions: string[] = [];
  try {
    tripExclusions = await listExcludedDriverIdsForTrip(trip.id);
    console.log("[dispatch:diag] publish_STEP_B_exclusions", {
      tripId: trip.id,
      tripExclusions,
    });
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

  let candidates;
  try {
    candidates = await listAvailableDrivers({
      excludePhone: options?.excludePhone,
    });
  } catch (error) {
    console.error("[dispatch:diag] STOP_at_publish_listAvailableDrivers", {
      tripId: trip.id,
      error,
    });
    throw error;
  }

  console.log("[dispatch:diag] publish_STEP_C_candidates", {
    tripId: trip.id,
    candidateCount: candidates.length,
    excludedDriverIds,
    candidateIds: candidates.map((d) => d.id),
  });

  const availableDrivers = filterDriversForTripOffer({
    drivers: candidates,
    excludedDriverIds,
  });

  console.log("[dispatch:diag] publish_STEP_D_after_exclusion_filter", {
    tripId: trip.id,
    eligibleCount: availableDrivers.length,
    eligibleIds: availableDrivers.map((d) => d.id),
  });

  if (availableDrivers.length === 0) {
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
    return;
  }

  const distanceKm =
    trip.distanceMeters != null
      ? (trip.distanceMeters / 1000).toFixed(1)
      : null;
  const durationMin =
    trip.durationSeconds != null
      ? Math.max(1, Math.round(trip.durationSeconds / 60))
      : null;

  const pickupLabel = trip.pickupLabel ?? trip.pickupNeighborhood;
  const mapsLink =
    trip.pickupLat != null && trip.pickupLng != null
      ? mapsUrlForCoords({ lat: trip.pickupLat, lng: trip.pickupLng })
      : null;

  const body = [
    "🚖 Nuevo servicio",
    "",
    `📍 Recoger en: ${pickupLabel}`,
    mapsLink ? `🧭 Ubicación de WhatsApp: ${mapsLink}` : "🧭 Ubicación de WhatsApp: (no disponible)",
    trip.dropoffLabel ? `🎯 Destino: ${trip.dropoffLabel}` : null,
    distanceKm ? `📏 Distancia estimada: ${distanceKm} km` : null,
    durationMin ? `⏱️ Tiempo estimado: ${durationMin} min` : null,
    trip.quotedFare != null
      ? `💰 Valor del servicio: ${formatFareCop(trip.quotedFare)}`
      : null,
    "",
    "Aceptar el servicio:",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const buttons = [
    { id: acceptButtonId(trip.id), title: "✅ Aceptar" },
    { id: rejectButtonId(trip.id), title: "❌ Rechazar" },
  ];

  console.log("[dispatch:diag] publish_STEP_E_whatsapp_sendButtonsMessage", {
    tripId: trip.id,
    recipientCount: availableDrivers.length,
    recipients: availableDrivers.map((d) => d.phone),
  });

  console.log("[dispatch] enviando oferta a conductores:", {
    tripId: trip.id,
    pickupNeighborhood: trip.pickupNeighborhood,
    excludedPhone: options?.excludePhone ?? null,
    excludedDriverIds,
    drivers: availableDrivers.map((d) => ({ id: d.id, phone: d.phone })),
  });

  const results = await Promise.allSettled(
    availableDrivers.map((driver) =>
      sendButtonsMessage(driver.phone, body, buttons),
    ),
  );

  results.forEach((result, index) => {
    const driver = availableDrivers[index];

    if (result.status === "fulfilled") {
      console.log("[dispatch:diag] publish_STEP_F_whatsapp_ok", {
        phone: driver.phone,
      });
      console.log("[dispatch] oferta enviada:", driver.phone);
    } else {
      console.error("[dispatch:diag] publish_STEP_F_whatsapp_fail", {
        phone: driver.phone,
        reason: result.reason,
      });
      console.error(
        "[dispatch] fallo al notificar:",
        driver.phone,
        result.reason,
      );
    }
  });
}

export async function handleDriverAccept(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    await sendTextMessage(
      driverPhone,
      "Este servicio ya fue tomado por otro conductor.",
    );
    return;
  }

  const driver = await findDriverByPhone(driverPhone);

  if (!driver) {
    await sendTextMessage(
      driverPhone,
      "No encontramos tu registro de conductor.",
    );
    return;
  }

  if (!driver.is_available) {
    await sendTextMessage(
      driverPhone,
      "No estás disponible para aceptar servicios en este momento.",
    );
    return;
  }

  // Usar el teléfono del webhook para que coincida en ETA / Llegué / Iniciar / Finalizar.
  const assigned = await tryAssignTrip(
    tripId,
    driver.id,
    driverPhone,
    driver.name,
  );

  if (!assigned) {
    await sendTextMessage(
      driverPhone,
      "Este servicio ya fue tomado por otro conductor.",
    );
    return;
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

  await Promise.allSettled([
    sendTextMessage(
      assigned.passengerPhone,
      [
        "✅ Conductor asignado",
        "",
        `Nombre: ${driver.name}`,
        `Placa: ${driver.plate}`,
      ].join("\n"),
    ),
    sendTextMessage(
      driverPhone,
      `✅ Servicio asignado.\n\n📍 Recogida: ${assigned.pickupNeighborhood}`,
    ),
  ]);

  // Diagnóstico: justo después de informar al pasajero (conductor / vehículo).
  await diagnoseTunnelVisibility({
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverPhone,
    expectedTunnelId: openedTunnelId,
    phase: "after_passenger_assignment_message",
  });

  await sendEtaOptions(driverPhone, assigned.id);

  console.log("[dispatch] viaje asignado:", {
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverId: driver.id,
    driverPhone,
    assignedDriverPhone: assigned.assignedDriverPhone,
  });
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
  await sendTextMessage(driverPhone, "Has rechazado el servicio.");
}

export async function handleDriverEta(
  driverPhone: string,
  tripId: string,
  minutes: number,
): Promise<void> {
  const { trip, source } = await resolveDriverTrip(tripId, driverPhone);

  if (!trip) {
    console.error("[dispatch] ETA sin viaje activo", { tripId, driverPhone, source });
    await sendTextMessage(
      driverPhone,
      "No encontramos un servicio activo asignado a ti.",
    );
    return;
  }

  if (trip.status !== "ASSIGNED") {
    await sendTextMessage(
      driverPhone,
      "El tiempo de llegada ya fue informado para este servicio.",
    );
    return;
  }

  const updated = await setTripEta(trip.id, minutes);

  if (!updated) {
    await sendTextMessage(
      driverPhone,
      "No se pudo registrar el tiempo de llegada.",
    );
    return;
  }

  const driverName = updated.assignedDriverName ?? "tu conductor";

  await sendButtonsMessage(
    updated.passengerPhone,
    `Tu conductor ${driverName} llegará aproximadamente en ${minutes} minutos.`,
    [
      {
        id: cancelServicioButtonId(updated.id),
        title: "❌ Cancelar servicio",
      },
    ],
  );

  await sendTextMessage(driverPhone, "✅ Tiempo informado al pasajero.");

  await sendArrivedButton(driverPhone, updated.id);

  console.log("[dispatch] ETA informado:", {
    tripId: updated.id,
    minutes,
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
    await sendTextMessage(
      driverPhone,
      "No encontramos un servicio activo asignado a ti.",
    );
    return;
  }

  if (trip.status !== "ETA_INFORMED") {
    await sendTextMessage(
      driverPhone,
      trip.status === "DRIVER_ARRIVED" || trip.status === "IN_PROGRESS"
        ? "La llegada ya fue informada para este servicio."
        : "Primero informa tu tiempo de llegada.",
    );
    return;
  }

  const updated = await markDriverArrived(trip.id);

  if (!updated) {
    await sendTextMessage(driverPhone, "No se pudo registrar la llegada.");
    return;
  }

  const driverName = updated.assignedDriverName ?? "tu conductor";

  await sendButtonsMessage(
    updated.passengerPhone,
    `📍 Tu conductor ${driverName} ya llegó al punto de recogida.`,
    [
      { id: yaVoyButtonId(updated.id), title: "✅ Ya voy" },
      {
        id: cancelServicioButtonId(updated.id),
        title: "❌ Cancelar servicio",
      },
    ],
  );

  await sendTextMessage(
    driverPhone,
    "✅ Se informó al pasajero que ya llegaste.",
  );

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
    await sendTextMessage(
      driverPhone,
      "No encontramos un servicio activo asignado a ti.",
    );
    return;
  }

  if (trip.status !== "DRIVER_ARRIVED") {
    await sendTextMessage(
      driverPhone,
      trip.status === "IN_PROGRESS" || trip.status === "COMPLETED"
        ? "El viaje ya fue iniciado."
        : "Primero confirma que llegaste al punto de recogida.",
    );
    return;
  }

  const updated = await startTrip(trip.id);

  if (!updated) {
    await sendTextMessage(driverPhone, "No se pudo iniciar el viaje.");
    return;
  }

  // Orden UX: iniciado → etiqueta destino → mapa → Al llegar… → Termina tu viaje.
  await sendTextMessage(driverPhone, "✅ Viaje iniciado.");
  await sendTextMessage(driverPhone, "📍 Ubicación del destino:");
  await sendDropoffLocationToDriver(driverPhone, updated);
  await sendFinishTripButton(driverPhone, updated.id);

  await sendTextMessage(
    updated.passengerPhone,
    "🚖 Tu viaje ha comenzado.",
  ).catch((error) => {
    console.error("[dispatch] no se pudo avisar al pasajero al iniciar:", error);
  });

  console.log("[dispatch] viaje iniciado:", {
    tripId: updated.id,
    driverPhone,
    resolveSource: source,
    dropoffLat: updated.dropoffLat,
    dropoffLng: updated.dropoffLng,
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
    await sendTextMessage(
      driverPhone,
      "No encontramos un servicio activo asignado a ti.",
    );
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
        ? "Este viaje ya fue finalizado."
        : "Primero inicia el viaje.",
    );
    return;
  }

  const updated = await finishTrip(trip.id);

  if (!updated) {
    await sendTextMessage(driverPhone, "No se pudo finalizar el viaje.");
    return;
  }

  if (updated.assignedDriverId) {
    await markDriverAvailable(updated.assignedDriverId);
  }

  await upsertSession(updated.passengerPhone, {
    state: "IDLE",
  });

  await Promise.allSettled([
    sendTextMessage(
      updated.passengerPhone,
      "🎉 Tu viaje ha finalizado. Gracias por elegir WhatXia Mobility.",
    ),
    sendTextMessage(
      driverPhone,
      "✅ Viaje finalizado. Ya estás disponible para recibir nuevos servicios.",
    ),
  ]);

  await sendRatingPrompt(updated.passengerPhone, updated.id);

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
  });
}
