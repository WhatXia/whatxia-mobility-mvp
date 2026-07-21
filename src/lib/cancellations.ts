import { getSupabase } from "@/lib/supabase/client";
import {
  findDriverByPhone,
  markDriverAvailable,
  markDriverUnavailable,
  type DriverRow,
} from "@/lib/supabase/drivers";
import { findPassengerByPhone } from "@/lib/supabase/passengers";
import { closeTunnelForTrip } from "@/lib/tunnels";
import {
  cancelTrip,
  findCancellableTripByPhone,
  getTrip,
  returnTripToSearching,
  samePhone,
  type Trip,
} from "@/lib/trips";
import { clearSession, upsertSession } from "@/lib/sessions";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export type CancelCausal =
  | "problema_mecanico"
  | "cliente_no_recogido"
  | "no_puedo_llegar";

export const CANCEL_CAUSALS: Record<
  CancelCausal,
  { label: string; buttonTitle: string }
> = {
  problema_mecanico: {
    label: "Problema mecánico",
    buttonTitle: "🔧 Prob. mecánico",
  },
  cliente_no_recogido: {
    label: "Cliente no recogido",
    buttonTitle: "👤 No recogido",
  },
  no_puedo_llegar: {
    label: "No puedo llegar al punto de recogida",
    buttonTitle: "📍 No puedo llegar",
  },
};

/** Causales que suman al historial/política del conductor. */
export const DRIVER_POLICY_CAUSALS: CancelCausal[] = [
  "problema_mecanico",
  "no_puedo_llegar",
];

export const SUSPENSION_MS = 8 * 60 * 60 * 1000;

export const CANCEL_SERVICIO_PREFIX = "cancel_servicio";
export const YA_VOY_PREFIX = "ya_voy";
export const CANCEL_CAUSAL_PREFIX = "cancel_causal";

export function cancelServicioButtonId(tripId: string) {
  return `${CANCEL_SERVICIO_PREFIX}:${tripId}`;
}

export function yaVoyButtonId(tripId: string) {
  return `${YA_VOY_PREFIX}:${tripId}`;
}

export function cancelCausalButtonId(causal: CancelCausal, tripId: string) {
  return `${CANCEL_CAUSAL_PREFIX}:${causal}:${tripId}`;
}

export function parseCancelServicioButton(
  button: string | null,
): { tripId: string } | null {
  if (!button?.startsWith(`${CANCEL_SERVICIO_PREFIX}:`)) {
    return null;
  }
  const tripId = button.slice(CANCEL_SERVICIO_PREFIX.length + 1);
  return tripId ? { tripId } : null;
}

export function parseYaVoyButton(
  button: string | null,
): { tripId: string } | null {
  if (!button?.startsWith(`${YA_VOY_PREFIX}:`)) {
    return null;
  }
  const tripId = button.slice(YA_VOY_PREFIX.length + 1);
  return tripId ? { tripId } : null;
}

export function parseCancelCausalButton(
  button: string | null,
): { causal: CancelCausal; tripId: string } | null {
  if (!button?.startsWith(`${CANCEL_CAUSAL_PREFIX}:`)) {
    return null;
  }
  const rest = button.slice(CANCEL_CAUSAL_PREFIX.length + 1);
  const [causalRaw, ...tripParts] = rest.split(":");
  const tripId = tripParts.join(":");
  if (
    causalRaw !== "problema_mecanico" &&
    causalRaw !== "cliente_no_recogido" &&
    causalRaw !== "no_puedo_llegar"
  ) {
    return null;
  }
  if (!tripId) {
    return null;
  }
  return { causal: causalRaw, tripId };
}

export function isDriverPolicyCausal(causal: CancelCausal): boolean {
  return DRIVER_POLICY_CAUSALS.includes(causal);
}

export function isPassengerNoShowCausal(causal: CancelCausal): boolean {
  return causal === "cliente_no_recogido";
}

/** Lógica pura de política del conductor (para certificación). */
export function nextDriverPolicyState(
  currentCount: number,
  causal: CancelCausal,
  nowMs: number = Date.now(),
): {
  incrementsDriver: boolean;
  incrementsPassenger: boolean;
  newCount: number;
  sendWarning: boolean;
  suspend: boolean;
  suspendedUntil: string | null;
} {
  const incrementsDriver = isDriverPolicyCausal(causal);
  const incrementsPassenger = isPassengerNoShowCausal(causal);
  const newCount = incrementsDriver ? currentCount + 1 : currentCount;

  return {
    incrementsDriver,
    incrementsPassenger,
    newCount,
    sendWarning: incrementsDriver && newCount === 2,
    suspend: incrementsDriver && newCount >= 3,
    suspendedUntil:
      incrementsDriver && newCount >= 3
        ? new Date(nowMs + SUSPENSION_MS).toISOString()
        : null,
  };
}

export function isDriverSuspended(
  driver: Pick<DriverRow, "suspended_until">,
  nowMs: number = Date.now(),
): boolean {
  if (!driver.suspended_until) {
    return false;
  }
  return new Date(driver.suspended_until).getTime() > nowMs;
}

export async function sendDriverCancelCausalMenu(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  await sendButtonsMessage(
    driverPhone,
    "¿Por qué deseas cancelar este servicio?",
    [
      {
        id: cancelCausalButtonId("problema_mecanico", tripId),
        title: CANCEL_CAUSALS.problema_mecanico.buttonTitle,
      },
      {
        id: cancelCausalButtonId("cliente_no_recogido", tripId),
        title: CANCEL_CAUSALS.cliente_no_recogido.buttonTitle,
      },
      {
        id: cancelCausalButtonId("no_puedo_llegar", tripId),
        title: CANCEL_CAUSALS.no_puedo_llegar.buttonTitle,
      },
    ],
  );
}

async function insertCancellation(input: {
  tripId: string;
  cancelledBy: "passenger" | "driver";
  driverId: string | null;
  passengerId: string | null;
  causal: CancelCausal | null;
}): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("trip_cancellations").insert({
    trip_id: input.tripId,
    cancelled_by: input.cancelledBy,
    driver_id: input.driverId,
    passenger_id: input.passengerId,
    causal: input.causal,
  });

  if (error) {
    console.error("[cancel] error al registrar causal:", error);
    throw error;
  }
}

async function incrementPassengerNoShow(passengerId: string): Promise<number> {
  const supabase = getSupabase();

  const { data: current, error: readError } = await supabase
    .from("passengers")
    .select("no_show_count")
    .eq("id", passengerId)
    .maybeSingle();

  if (readError) {
    console.error("[cancel] error al leer no_show_count:", readError);
    throw readError;
  }

  const next = (current?.no_show_count ?? 0) + 1;

  const { error } = await supabase
    .from("passengers")
    .update({ no_show_count: next })
    .eq("id", passengerId);

  if (error) {
    console.error("[cancel] error al incrementar no_show_count:", error);
    throw error;
  }

  return next;
}

async function applyDriverPolicy(
  driver: DriverRow,
  causal: CancelCausal,
): Promise<{
  newCount: number;
  warned: boolean;
  suspended: boolean;
}> {
  const policy = nextDriverPolicyState(driver.cancel_policy_count ?? 0, causal);
  const supabase = getSupabase();

  if (!policy.incrementsDriver) {
    return {
      newCount: driver.cancel_policy_count ?? 0,
      warned: false,
      suspended: false,
    };
  }

  const update: Record<string, unknown> = {
    cancel_policy_count: policy.newCount,
  };

  if (policy.suspend && policy.suspendedUntil) {
    update.suspended_until = policy.suspendedUntil;
    update.is_available = false;
  }

  const { error } = await supabase
    .from("drivers")
    .update(update)
    .eq("id", driver.id);

  if (error) {
    console.error("[cancel] error al aplicar política conductor:", error);
    throw error;
  }

  if (policy.sendWarning) {
    await sendTextMessage(
      driver.phone,
      "Esta es tu segunda cancelación registrada. Recuerda aceptar únicamente los servicios que realmente puedas atender.",
    );
  }

  if (policy.suspend) {
    await sendTextMessage(
      driver.phone,
      "Has acumulado 3 cancelaciones. Tu cuenta queda suspendida 8 horas y no recibirás nuevas ofertas hasta entonces.",
    );
  }

  return {
    newCount: policy.newCount,
    warned: policy.sendWarning,
    suspended: policy.suspend,
  };
}

async function releaseDriverIfAllowed(driverId: string | null): Promise<void> {
  if (!driverId) {
    return;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();

  if (error) {
    console.error("[cancel] error al leer conductor para liberar:", error);
    throw error;
  }

  if (!data) {
    return;
  }

  const driver = data as DriverRow;

  if (isDriverSuspended(driver)) {
    await markDriverUnavailable(driverId).catch(() => undefined);
    return;
  }

  await markDriverAvailable(driverId);
}

/**
 * Cancelación iniciada por el pasajero (sin causal).
 */
export async function cancelTripAsPassenger(
  passengerPhone: string,
  tripId: string,
): Promise<Trip | null> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(
      passengerPhone,
      "No encontramos un servicio activo para cancelar.",
    );
    return null;
  }

  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") {
    await sendTextMessage(passengerPhone, "Este servicio ya no se puede cancelar.");
    return null;
  }

  const cancelled = await cancelTrip(trip.id);
  if (!cancelled) {
    await sendTextMessage(passengerPhone, "No se pudo cancelar el servicio.");
    return null;
  }

  const passenger = await findPassengerByPhone(passengerPhone);

  await insertCancellation({
    tripId: cancelled.id,
    cancelledBy: "passenger",
    driverId: cancelled.assignedDriverId,
    passengerId: passenger?.id ?? cancelled.passengerId,
    causal: null,
  });

  await closeTunnelForTrip(cancelled.id);
  await clearSession(passengerPhone);
  await releaseDriverIfAllowed(cancelled.assignedDriverId);

  await Promise.allSettled([
    sendTextMessage(
      passengerPhone,
      "Servicio cancelado. El canal de comunicación se cerró.",
    ),
    cancelled.assignedDriverPhone
      ? sendTextMessage(
          cancelled.assignedDriverPhone,
          "El pasajero canceló el servicio. Ya puedes recibir nuevas ofertas.",
        )
      : Promise.resolve(),
  ]);

  console.log("[cancel:passenger]", { tripId: cancelled.id, passengerPhone });
  return cancelled;
}

/**
 * Cancelación del conductor con causal: reasignación automática (Sprint 21).
 * No cancela el viaje; vuelve a SEARCHING y republica la oferta.
 * El Conversation Tunnel permanece abierto (sin enrutar hasta nuevo accept).
 */
export async function cancelTripAsDriver(
  driverPhone: string,
  tripId: string,
  causal: CancelCausal,
): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  const driver = await findDriverByPhone(driverPhone);

  if (
    !trip ||
    !driver ||
    !samePhone(trip.assignedDriverPhone, driverPhone)
  ) {
    await sendTextMessage(
      driverPhone,
      "No encontramos un servicio activo para cancelar.",
    );
    return null;
  }

  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") {
    await sendTextMessage(driverPhone, "Este servicio ya no se puede cancelar.");
    return null;
  }

  if (trip.status === "SEARCHING") {
    await sendTextMessage(
      driverPhone,
      "Este servicio ya está en búsqueda de otro conductor.",
    );
    return null;
  }

  const previousDriverId = driver.id;
  const passengerPhone = trip.passengerPhone;
  const pickup = trip.pickupNeighborhood;

  const passenger = trip.passengerId
    ? { id: trip.passengerId }
    : await findPassengerByPhone(passengerPhone);

  await insertCancellation({
    tripId: trip.id,
    cancelledBy: "driver",
    driverId: driver.id,
    passengerId: passenger?.id ?? null,
    causal,
  });

  if (isPassengerNoShowCausal(causal) && passenger?.id) {
    const noShow = await incrementPassengerNoShow(passenger.id);
    console.log("[cancel:passenger-no-show]", {
      passengerId: passenger.id,
      noShowCount: noShow,
    });
  }

  const policy = await applyDriverPolicy(driver, causal);

  const researching = await returnTripToSearching(trip.id);

  if (!researching) {
    await sendTextMessage(
      driverPhone,
      "No se pudo reasignar el servicio. Contacta soporte.",
    );
    return null;
  }

  // Exclusión solo para este trip_id (evita ciclo accept→cancel→misma oferta).
  const { addTripDriverExclusion } = await import("@/lib/trip-exclusions");
  await addTripDriverExclusion(researching.id, previousDriverId);

  // Debe quedar disponible de inmediato para OTROS viajes (salvo suspensión).
  if (!policy.suspended) {
    await releaseDriverIfAllowed(driver.id);
  }

  await upsertSession(passengerPhone, {
    state: "SEARCHING_DRIVER",
    pickupNeighborhood: pickup,
  });

  const causalLabel = CANCEL_CAUSALS[causal].label;

  await Promise.allSettled([
    sendTextMessage(
      driverPhone,
      `Servicio cancelado (${causalLabel}). Ya puedes recibir otros servicios.`,
    ),
    sendTextMessage(
      passengerPhone,
      "Tu conductor canceló el servicio. Estamos buscando otro conductor para ti. Un momento, por favor.",
    ),
  ]);

  const { republishTripToDrivers } = await import("@/lib/dispatch");
  await republishTripToDrivers(researching.id);

  console.log("[cancel:driver:reassign]", {
    tripId: researching.id,
    driverId: driver.id,
    excludedFromTrip: previousDriverId,
    causal,
    policyCount: policy.newCount,
    warned: policy.warned,
    suspended: policy.suspended,
    availableForOtherTrips: !policy.suspended,
  });

  return researching;
}

/**
 * Cancelación genérica (texto/botón menú): pasajero cancela;
 * conductor recibe menú de causales.
 */
export async function cancelTripByPhone(
  phone: string,
): Promise<Trip | null> {
  const trip = await findCancellableTripByPhone(phone);
  if (!trip) {
    return null;
  }

  if (samePhone(phone, trip.passengerPhone)) {
    return cancelTripAsPassenger(phone, trip.id);
  }

  await sendDriverCancelCausalMenu(phone, trip.id);
  return trip;
}

export async function handlePassengerYaVoy(
  passengerPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(passengerPhone, "No encontramos ese servicio.");
    return;
  }

  if (trip.status !== "DRIVER_ARRIVED") {
    await sendTextMessage(
      passengerPhone,
      "Esta opción solo aplica cuando el conductor ya llegó.",
    );
    return;
  }

  await sendTextMessage(passengerPhone, "Listo, le avisamos a tu conductor.");

  if (trip.assignedDriverPhone) {
    await sendTextMessage(
      trip.assignedDriverPhone,
      "🚶 El pasajero indicó que ya va hacia el punto de recogida.",
    );
  }
}
