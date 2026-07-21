import {
  findDriverByPhone,
  listAvailableDrivers,
  markDriverUnavailable,
} from "@/lib/supabase/drivers";
import { createTrip, getTrip, tryAssignTrip } from "@/lib/trips";
import { upsertSession } from "@/lib/sessions";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export const DRIVER_BUTTON_IDS = {
  ACEPTAR: "aceptar_servicio",
  RECHAZAR: "rechazar_servicio",
} as const;

function acceptButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.ACEPTAR}:${tripId}`;
}

function rejectButtonId(tripId: string) {
  return `${DRIVER_BUTTON_IDS.RECHAZAR}:${tripId}`;
}

export function parseDriverButton(
  button: string | null,
): { action: "accept" | "reject"; tripId: string } | null {
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

  // Compatibilidad con botones antiguos sin tripId.
  if (button === DRIVER_BUTTON_IDS.ACEPTAR) {
    return null;
  }

  if (button === DRIVER_BUTTON_IDS.RECHAZAR) {
    return null;
  }

  return null;
}

export async function offerTripToDrivers(
  passengerPhone: string,
  pickupNeighborhood: string,
) {
  const availableDrivers = await listAvailableDrivers();

  if (availableDrivers.length === 0) {
    console.warn("[dispatch] no hay conductores disponibles");
    await sendTextMessage(
      passengerPhone,
      "Por ahora no hay conductores disponibles. Intenta de nuevo en un momento.",
    );
    return;
  }

  const trip = createTrip(passengerPhone, pickupNeighborhood);

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
  const trip = getTrip(tripId);

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

  const assigned = tryAssignTrip(tripId, driver.id, driver.phone);

  if (!assigned) {
    await sendTextMessage(
      driverPhone,
      "Este servicio ya fue tomado por otro conductor.",
    );
    return;
  }

  await markDriverUnavailable(driver.id);

  upsertSession(assigned.passengerPhone, {
    state: "ASSIGNED",
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

  console.log("[dispatch] viaje asignado:", {
    tripId: assigned.id,
    passengerPhone: assigned.passengerPhone,
    driverId: driver.id,
    driverPhone: driver.phone,
  });
}

export async function handleDriverReject(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  const trip = getTrip(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    return;
  }

  console.log("[dispatch] conductor rechazó:", { tripId, driverPhone });
  await sendTextMessage(driverPhone, "Has rechazado el servicio.");
}
