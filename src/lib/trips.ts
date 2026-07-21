import { getSupabase } from "@/lib/supabase/client";

export type TripStatus =
  | "SEARCHING"
  | "ASSIGNED"
  | "ETA_INFORMED"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type Trip = {
  id: string;
  passengerId: string | null;
  passengerPhone: string;
  pickupNeighborhood: string;
  status: TripStatus;
  assignedDriverId: string | null;
  assignedDriverPhone: string | null;
  assignedDriverName: string | null;
  etaMinutes: number | null;
  rating: number | null;
};

type TripRow = {
  id: string;
  passenger_id: string | null;
  passenger_phone: string;
  pickup_neighborhood: string;
  status: TripStatus;
  driver_id: string | null;
  driver_phone: string | null;
  driver_name: string | null;
  eta_minutes: number | null;
  rating: number | null;
};

const ACTIVE_STATUSES: TripStatus[] = [
  "ASSIGNED",
  "ETA_INFORMED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
];

const CANCELLABLE_STATUSES: TripStatus[] = [
  "SEARCHING",
  ...ACTIVE_STATUSES,
];

const TRIP_COLUMNS =
  "id, passenger_id, passenger_phone, pickup_neighborhood, status, driver_id, driver_phone, driver_name, eta_minutes, rating";

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return normalizePhone(a) === normalizePhone(b);
}

function mapRow(row: TripRow): Trip {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    passengerPhone: row.passenger_phone,
    pickupNeighborhood: row.pickup_neighborhood,
    status: row.status,
    assignedDriverId: row.driver_id,
    assignedDriverPhone: row.driver_phone,
    assignedDriverName: row.driver_name,
    etaMinutes: row.eta_minutes,
    rating: row.rating,
  };
}

function logTransition(
  trip: Trip,
  from: TripStatus | "NONE",
  to: TripStatus,
): void {
  console.log("[trip:transition]", {
    tripId: trip.id,
    driverPhone: trip.assignedDriverPhone,
    from,
    to,
    status: trip.status,
  });
}

export async function createTrip(
  passengerPhone: string,
  pickupNeighborhood: string,
  passengerId: string,
): Promise<Trip> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trips")
    .insert({
      passenger_id: passengerId,
      passenger_phone: normalizePhone(passengerPhone),
      pickup_neighborhood: pickupNeighborhood,
      status: "SEARCHING",
    })
    .select(TRIP_COLUMNS)
    .single();

  if (error) {
    console.error("[supabase] error al crear viaje:", error);
    throw error;
  }

  const trip = mapRow(data as TripRow);
  console.log("[trip:created]", {
    tripId: trip.id,
    passengerId: trip.passengerId,
    passengerPhone: trip.passengerPhone,
    status: trip.status,
  });
  return trip;
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("id", tripId)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al obtener viaje:", error);
    throw error;
  }

  return data ? mapRow(data as TripRow) : null;
}

async function findActiveTripByDriverPhone(
  driverPhone: string,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(driverPhone);

  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("driver_phone", normalized)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar viaje activo:", error);
    throw error;
  }

  return data ? mapRow(data as TripRow) : null;
}

/**
 * Resuelve el viaje activo del conductor desde Supabase.
 * 1) Por tripId del botón
 * 2) Fallback por teléfono del conductor
 */
export async function resolveDriverTrip(
  tripId: string,
  driverPhone: string,
): Promise<{ trip: Trip | null; source: "tripId" | "driverPhone" | "none" }> {
  let trip = await getTrip(tripId);
  let source: "tripId" | "driverPhone" | "none" = trip ? "tripId" : "none";

  console.log("[trip:resolve]", {
    requestedTripId: tripId,
    driverPhone,
    normalizedPhone: normalizePhone(driverPhone),
    foundByTripId: Boolean(trip),
    statusFound: trip?.status ?? null,
    assignedDriverPhone: trip?.assignedDriverPhone ?? null,
  });

  if (trip && !samePhone(trip.assignedDriverPhone, driverPhone)) {
    console.warn("[trip:resolve] phone mismatch on tripId lookup", {
      tripId,
      assignedDriverPhone: trip.assignedDriverPhone,
      driverPhone,
    });
    trip = null;
    source = "none";
  }

  if (!trip) {
    const fallback = await findActiveTripByDriverPhone(driverPhone);

    console.log("[trip:resolve:fallback]", {
      found: Boolean(fallback),
      fallbackId: fallback?.id ?? null,
      statusFound: fallback?.status ?? null,
    });

    if (fallback && samePhone(fallback.assignedDriverPhone, driverPhone)) {
      trip = fallback;
      source = "driverPhone";
    }
  }

  if (!trip) {
    return { trip: null, source: "none" };
  }

  return { trip, source };
}

/** Asigna el viaje al primer conductor. Devuelve null si ya fue tomado. */
export async function tryAssignTrip(
  tripId: string,
  driverId: string,
  driverPhone: string,
  driverName: string,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "SEARCHING") {
    console.warn("[trip:assign:rejected]", {
      tripId,
      driverPhone,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "ASSIGNED",
      driver_id: driverId,
      driver_phone: normalizePhone(driverPhone),
      driver_name: driverName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "SEARCHING")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al asignar viaje:", error);
    throw error;
  }

  if (!data) {
    console.warn("[trip:assign:race]", { tripId, driverPhone });
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, "SEARCHING", "ASSIGNED");
  return trip;
}

export async function setTripEta(
  tripId: string,
  minutes: number,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "ASSIGNED") {
    console.warn("[trip:eta:rejected]", {
      tripId,
      driverPhone: current?.assignedDriverPhone ?? null,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "ETA_INFORMED",
      eta_minutes: minutes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "ASSIGNED")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al guardar ETA:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, "ASSIGNED", "ETA_INFORMED");
  return trip;
}

export async function markDriverArrived(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "ETA_INFORMED") {
    console.warn("[trip:arrived:rejected]", {
      tripId,
      driverPhone: current?.assignedDriverPhone ?? null,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "DRIVER_ARRIVED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "ETA_INFORMED")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar llegada:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, "ETA_INFORMED", "DRIVER_ARRIVED");
  return trip;
}

export async function startTrip(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "DRIVER_ARRIVED") {
    console.warn("[trip:start:rejected]", {
      tripId,
      driverPhone: current?.assignedDriverPhone ?? null,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "DRIVER_ARRIVED")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al iniciar viaje:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, "DRIVER_ARRIVED", "IN_PROGRESS");
  return trip;
}

export async function finishTrip(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "IN_PROGRESS") {
    console.warn("[trip:finish:rejected]", {
      tripId,
      driverPhone: current?.assignedDriverPhone ?? null,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "COMPLETED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "IN_PROGRESS")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al finalizar viaje:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, "IN_PROGRESS", "COMPLETED");
  return trip;
}

export async function findCancellableTripByPhone(
  phone: string,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data: asPassenger, error: passengerError } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("passenger_phone", normalized)
    .in("status", CANCELLABLE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (passengerError) {
    console.error("[supabase] error al buscar viaje cancelable (pasajero):", passengerError);
    throw passengerError;
  }

  if (asPassenger) {
    return mapRow(asPassenger as TripRow);
  }

  const { data: asDriver, error: driverError } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("driver_phone", normalized)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (driverError) {
    console.error("[supabase] error al buscar viaje cancelable (conductor):", driverError);
    throw driverError;
  }

  return asDriver ? mapRow(asDriver as TripRow) : null;
}

export async function cancelTrip(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || !CANCELLABLE_STATUSES.includes(current.status)) {
    console.warn("[trip:cancel:rejected]", {
      tripId,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const from = current.status;

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "CANCELLED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .in("status", CANCELLABLE_STATUSES)
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al cancelar viaje:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, from, "CANCELLED");
  return trip;
}

export async function setTripRating(
  tripId: string,
  rating: number,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || current.status !== "COMPLETED") {
    return null;
  }

  if (current.rating !== null) {
    return null;
  }

  const { data, error } = await supabase
    .from("trips")
    .update({
      rating,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "COMPLETED")
    .is("rating", null)
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al guardar rating:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  console.log("[trip:rating]", {
    tripId: trip.id,
    driverPhone: trip.assignedDriverPhone,
    rating: trip.rating,
    status: trip.status,
  });
  return trip;
}
