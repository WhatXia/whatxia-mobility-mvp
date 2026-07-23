import { getSupabase } from "@/lib/supabase/client";
import { getActiveCity } from "@/lib/city/context";

export type TripStatus =
  | "SEARCHING"
  | "ASSIGNED"
  | "ETA_INFORMED"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "cancelled_no_driver";

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
  searchDeadlineAt: string | null;
  continueDeadlineAt: string | null;
  searchAwaitingContinue: boolean;
  searchReminderCount: number;
  pickupLat: number | null;
  pickupLng: number | null;
  pickupPlaceId: string | null;
  pickupLabel: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  dropoffPlaceId: string | null;
  dropoffLabel: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  quotedFare: number | null;
  /** Tarifa oficial al finalizar (Tariff Engine). */
  finalFare: number | null;
  waitSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  currency: string;
  cityId: string | null;
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
  search_deadline_at: string | null;
  continue_deadline_at: string | null;
  search_awaiting_continue: boolean | null;
  search_reminder_count: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_place_id: string | null;
  pickup_label: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_place_id: string | null;
  dropoff_label: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  quoted_fare: number | null;
  final_fare: number | null;
  wait_seconds: number | null;
  started_at: string | null;
  finished_at: string | null;
  currency: string | null;
  city_id: string | null;
};

export type CreateTripGeoInput = {
  pickupLat: number;
  pickupLng: number;
  pickupPlaceId: string | null;
  pickupLabel: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffPlaceId: string | null;
  dropoffLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  quotedFare: number;
  currency?: string;
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

/** WaitingFlow: ventana entre recordatorios / búsqueda (2 min). */
export const SEARCH_WINDOW_MS = 2 * 60 * 1000;
/** WaitingFlow: tiempo máximo esperando respuesta del pasajero (2 min). */
export const CONTINUE_WINDOW_MS = 2 * 60 * 1000;
/** Tras 2 “seguir buscando”, la 3ª ventana de 2 min cierra sin conductor. */
export const MAX_SEARCH_REMINDER_COUNT = 2;

const TRIP_COLUMNS =
  "id, passenger_id, passenger_phone, pickup_neighborhood, status, driver_id, driver_phone, driver_name, eta_minutes, rating, search_deadline_at, continue_deadline_at, search_awaiting_continue, search_reminder_count, pickup_lat, pickup_lng, pickup_place_id, pickup_label, dropoff_lat, dropoff_lng, dropoff_place_id, dropoff_label, distance_meters, duration_seconds, quoted_fare, final_fare, wait_seconds, started_at, finished_at, currency, city_id";

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
    searchDeadlineAt: row.search_deadline_at,
    continueDeadlineAt: row.continue_deadline_at,
    searchAwaitingContinue: Boolean(row.search_awaiting_continue),
    searchReminderCount: row.search_reminder_count ?? 0,
    pickupLat: row.pickup_lat ?? null,
    pickupLng: row.pickup_lng ?? null,
    pickupPlaceId: row.pickup_place_id ?? null,
    pickupLabel: row.pickup_label ?? null,
    dropoffLat: row.dropoff_lat ?? null,
    dropoffLng: row.dropoff_lng ?? null,
    dropoffPlaceId: row.dropoff_place_id ?? null,
    dropoffLabel: row.dropoff_label ?? null,
    distanceMeters: row.distance_meters ?? null,
    durationSeconds: row.duration_seconds ?? null,
    quotedFare: row.quoted_fare ?? null,
    finalFare: row.final_fare ?? null,
    waitSeconds: row.wait_seconds ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    currency: row.currency ?? "COP",
    cityId: row.city_id ?? null,
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
  geo?: CreateTripGeoInput,
): Promise<Trip> {
  const supabase = getSupabase();
  const city = await getActiveCity();
  const searchDeadline = new Date(
    Date.now() + SEARCH_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabase
    .from("trips")
    .insert({
      passenger_id: passengerId,
      passenger_phone: normalizePhone(passengerPhone),
      pickup_neighborhood: pickupNeighborhood,
      status: "SEARCHING",
      search_deadline_at: searchDeadline,
      continue_deadline_at: null,
      search_awaiting_continue: false,
      search_reminder_count: 0,
      city_id: city.id,
      ...(geo
        ? {
            pickup_lat: geo.pickupLat,
            pickup_lng: geo.pickupLng,
            pickup_place_id: geo.pickupPlaceId,
            pickup_label: geo.pickupLabel,
            dropoff_lat: geo.dropoffLat,
            dropoff_lng: geo.dropoffLng,
            dropoff_place_id: geo.dropoffPlaceId,
            dropoff_label: geo.dropoffLabel,
            distance_meters: geo.distanceMeters,
            duration_seconds: geo.durationSeconds,
            quoted_fare: geo.quotedFare,
            currency: geo.currency ?? "COP",
          }
        : {}),
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
    searchDeadlineAt: trip.searchDeadlineAt,
    quotedFare: trip.quotedFare,
    distanceMeters: trip.distanceMeters,
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

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "IN_PROGRESS",
      started_at: now,
      updated_at: now,
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

export type FinishTripFareInput = {
  finalFare: number;
  waitSeconds?: number;
  finishedAt?: string;
};

export async function finishTrip(
  tripId: string,
  fare?: FinishTripFareInput,
): Promise<Trip | null> {
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

  const now = fare?.finishedAt ?? new Date().toISOString();
  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "COMPLETED",
      finished_at: now,
      updated_at: now,
      ...(fare
        ? {
            final_fare: fare.finalFare,
            wait_seconds: fare.waitSeconds ?? 0,
          }
        : {}),
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

export async function cancelTrip(
  tripId: string,
  status: "CANCELLED" | "cancelled_no_driver" = "CANCELLED",
): Promise<Trip | null> {
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
      status,
      search_deadline_at: null,
      continue_deadline_at: null,
      search_awaiting_continue: false,
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
  logTransition(trip, from, status);
  return trip;
}

/** Vuelve el viaje a SEARCHING (reasignación tras cancelación del conductor). */
export async function returnTripToSearching(
  tripId: string,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const current = await getTrip(tripId);

  if (!current || !ACTIVE_STATUSES.includes(current.status)) {
    console.warn("[trip:research:rejected]", {
      tripId,
      statusFound: current?.status ?? null,
    });
    return null;
  }

  const from = current.status;
  const searchDeadline = new Date(
    Date.now() + SEARCH_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabase
    .from("trips")
    .update({
      status: "SEARCHING",
      driver_id: null,
      driver_phone: null,
      driver_name: null,
      eta_minutes: null,
      search_deadline_at: searchDeadline,
      continue_deadline_at: null,
      search_awaiting_continue: false,
      search_reminder_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .in("status", ACTIVE_STATUSES)
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al volver a SEARCHING:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  const trip = mapRow(data as TripRow);
  logTransition(trip, from, "SEARCHING");
  return trip;
}

export async function startSearchCycle(tripId: string): Promise<Trip | null> {
  const supabase = getSupabase();
  const searchDeadline = new Date(
    Date.now() + SEARCH_WINDOW_MS,
  ).toISOString();

  const { data, error } = await supabase
    .from("trips")
    .update({
      search_deadline_at: searchDeadline,
      continue_deadline_at: null,
      search_awaiting_continue: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "SEARCHING")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al iniciar ciclo de búsqueda:", error);
    throw error;
  }

  return data ? mapRow(data as TripRow) : null;
}

/** Tras “Seguir buscando”: incrementa recordatorio y reinicia ventana de 2 min. */
export async function continueWaitingSearchCycle(
  tripId: string,
): Promise<Trip | null> {
  const current = await getTrip(tripId);
  if (!current || current.status !== "SEARCHING") {
    return null;
  }

  const nextCount = Math.min(
    current.searchReminderCount + 1,
    MAX_SEARCH_REMINDER_COUNT,
  );
  const searchDeadline = new Date(
    Date.now() + SEARCH_WINDOW_MS,
  ).toISOString();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trips")
    .update({
      search_reminder_count: nextCount,
      search_deadline_at: searchDeadline,
      continue_deadline_at: null,
      search_awaiting_continue: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "SEARCHING")
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al continuar WaitingFlow:", error);
    throw error;
  }

  return data ? mapRow(data as TripRow) : null;
}

export async function markSearchAwaitingContinue(
  tripId: string,
): Promise<Trip | null> {
  const supabase = getSupabase();
  const now = Date.now();
  const continueDeadline = new Date(now + CONTINUE_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from("trips")
    .update({
      search_awaiting_continue: true,
      continue_deadline_at: continueDeadline,
      // Evita re-enviar el mismo prompt si el cron/webhook corre otra vez.
      search_deadline_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId)
    .eq("status", "SEARCHING")
    .eq("search_awaiting_continue", false)
    .not("search_deadline_at", "is", null)
    .lte("search_deadline_at", new Date(now).toISOString())
    .select(TRIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar awaiting continue:", error);
    throw error;
  }

  return data ? mapRow(data as TripRow) : null;
}

export async function clearSearchDeadlinesOnAssign(
  tripId: string,
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("trips")
    .update({
      search_deadline_at: null,
      continue_deadline_at: null,
      search_awaiting_continue: false,
      search_reminder_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tripId);
}

export async function listTripsDueSearchPrompt(
  nowIso: string = new Date().toISOString(),
): Promise<Trip[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("status", "SEARCHING")
    .eq("search_awaiting_continue", false)
    .not("search_deadline_at", "is", null)
    .lte("search_deadline_at", nowIso)
    .limit(50);

  if (error) {
    console.error("[supabase] error listando prompts de búsqueda:", error);
    throw error;
  }

  return (data ?? []).map((row) => mapRow(row as TripRow));
}

export async function listTripsDueContinueTimeout(
  nowIso: string = new Date().toISOString(),
): Promise<Trip[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trips")
    .select(TRIP_COLUMNS)
    .eq("status", "SEARCHING")
    .eq("search_awaiting_continue", true)
    .not("continue_deadline_at", "is", null)
    .lte("continue_deadline_at", nowIso)
    .limit(50);

  if (error) {
    console.error("[supabase] error listando timeout continue:", error);
    throw error;
  }

  return (data ?? []).map((row) => mapRow(row as TripRow));
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
