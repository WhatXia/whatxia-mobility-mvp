import {
  findDriverByPhone,
  listAvailableDrivers,
  markDriverAvailable,
  markDriverUnavailable,
} from "@/lib/supabase/drivers";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import {
  cancelTrip,
  createTrip,
  findCancellableTripByPhone,
  finishTrip,
  getTrip,
  markDriverArrived,
  resolveDriverTrip,
  samePhone,
  setTripEta,
  startTrip,
  tryAssignTrip,
  type Trip,
} from "@/lib/trips";
import { upsertSession } from "@/lib/sessions";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import { sendRatingPrompt } from "@/lib/rating";
import {
  closeTunnelForTrip,
  openTunnel,
  scheduleTunnelClose,
} from "@/lib/tunnels";

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
  ]);
}

async function sendStartTripButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(driverPhone, "Cuando el pasajero suba:", [
    { id: iniciarButtonId(tripId), title: "▶️ Iniciar viaje" },
  ]);
}

async function sendFinishTripButton(driverPhone: string, tripId: string) {
  await sendButtonsMessage(driverPhone, "Cuando lleguen al destino:", [
    { id: finalizarButtonId(tripId), title: "🏁 Finalizar viaje" },
  ]);
}

export async function offerTripToDrivers(
  passengerPhone: string,
  pickupNeighborhood: string,
) {
  const requesterDriver = await findDriverByPhone(passengerPhone);

  const availableDrivers = await listAvailableDrivers({
    excludePhone: passengerPhone,
    excludeDriverId: requesterDriver?.id,
  });

  if (availableDrivers.length === 0) {
    console.warn("[dispatch] no hay conductores disponibles");
    await sendTextMessage(
      passengerPhone,
      "Por ahora no hay conductores disponibles. Intenta de nuevo en un momento.",
    );
    return;
  }

  const passenger = await findOrCreatePassenger(passengerPhone);
  const trip = await createTrip(
    passengerPhone,
    pickupNeighborhood,
    passenger.id,
  );

  const body = [
    "🚖 Nuevo servicio",
    "",
    "📍 Recogida:",
    pickupNeighborhood,
    "",
    "Aceptar el servicio:",
  ].join("\n");

  const buttons = [
    { id: acceptButtonId(trip.id), title: "✅ Aceptar" },
    { id: rejectButtonId(trip.id), title: "❌ Rechazar" },
  ];

  console.log("[dispatch] enviando oferta a conductores:", {
    tripId: trip.id,
    pickupNeighborhood,
    excludedPhone: passengerPhone,
    excludedDriverId: requesterDriver?.id ?? null,
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
      console.log("[dispatch] oferta enviada:", driver.phone);
    } else {
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

  await openTunnel({
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverPhone,
  });

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

  await Promise.allSettled([
    sendTextMessage(
      updated.passengerPhone,
      `Tu conductor ${driverName} llegará aproximadamente en ${minutes} minutos.`,
    ),
    sendTextMessage(driverPhone, "✅ Tiempo informado al pasajero."),
  ]);

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

  await Promise.allSettled([
    sendTextMessage(
      updated.passengerPhone,
      `📍 Tu conductor ${driverName} ya llegó al punto de recogida.`,
    ),
    sendTextMessage(
      driverPhone,
      "✅ Se informó al pasajero que ya llegaste.",
    ),
  ]);

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

  await Promise.allSettled([
    sendTextMessage(updated.passengerPhone, "🚖 Tu viaje ha comenzado."),
    sendTextMessage(driverPhone, "✅ Viaje iniciado."),
  ]);

  await sendFinishTripButton(driverPhone, updated.id);

  console.log("[dispatch] viaje iniciado:", {
    tripId: updated.id,
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

  // active → closing + closes_at = now + 20 min
  await scheduleTunnelClose(updated.id);

  console.log("[dispatch] viaje finalizado:", {
    tripId: updated.id,
    driverPhone,
    driverId: updated.assignedDriverId,
    resolveSource: source,
  });
}

/**
 * Cancela el viaje del participante y cierra el túnel de inmediato.
 * No permite más mensajes por el canal.
 */
export async function cancelTripByPhone(
  phone: string,
): Promise<Trip | null> {
  const trip = await findCancellableTripByPhone(phone);
  if (!trip) {
    return null;
  }

  const cancelled = await cancelTrip(trip.id);
  if (!cancelled) {
    return null;
  }

  if (cancelled.assignedDriverId) {
    await markDriverAvailable(cancelled.assignedDriverId);
  }

  await closeTunnelForTrip(cancelled.id);

  const peerPhone = samePhone(phone, cancelled.passengerPhone)
    ? cancelled.assignedDriverPhone
    : cancelled.passengerPhone;

  await Promise.allSettled([
    sendTextMessage(
      phone,
      "Viaje cancelado. El canal de comunicación se cerró.",
    ),
    peerPhone
      ? sendTextMessage(
          peerPhone,
          "El viaje fue cancelado. El canal de comunicación se cerró.",
        )
      : Promise.resolve(),
  ]);

  console.log("[dispatch] viaje cancelado:", {
    tripId: cancelled.id,
    byPhone: phone,
  });

  return cancelled;
}
