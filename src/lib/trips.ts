export type TripStatus =
  | "SEARCHING"
  | "ASSIGNED"
  | "ETA_INFORMED"
  | "DRIVER_ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED";

export type Trip = {
  id: string;
  passengerPhone: string;
  pickupNeighborhood: string;
  status: TripStatus;
  assignedDriverId: string | null;
  assignedDriverPhone: string | null;
  assignedDriverName: string | null;
  etaMinutes: number | null;
  rating: number | null;
};

type TripsGlobal = {
  trips?: Map<string, Trip>;
  activeTripByDriverPhone?: Map<string, string>;
};

const globalStore = globalThis as typeof globalThis & TripsGlobal;

/** Persiste entre recargas HMR / workers del mismo proceso (Next.js). */
function getTripsMap(): Map<string, Trip> {
  if (!globalStore.trips) {
    globalStore.trips = new Map();
  }
  return globalStore.trips;
}

function getDriverIndex(): Map<string, string> {
  if (!globalStore.activeTripByDriverPhone) {
    globalStore.activeTripByDriverPhone = new Map();
  }
  return globalStore.activeTripByDriverPhone;
}

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

export function createTrip(
  passengerPhone: string,
  pickupNeighborhood: string,
): Trip {
  const trip: Trip = {
    id: crypto.randomUUID(),
    passengerPhone,
    pickupNeighborhood,
    status: "SEARCHING",
    assignedDriverId: null,
    assignedDriverPhone: null,
    assignedDriverName: null,
    etaMinutes: null,
    rating: null,
  };

  getTripsMap().set(trip.id, trip);
  console.log("[trip:created]", {
    tripId: trip.id,
    passengerPhone,
    status: trip.status,
  });
  return trip;
}

export function getTrip(tripId: string): Trip | undefined {
  return getTripsMap().get(tripId);
}

/**
 * Resuelve el viaje activo del conductor.
 * 1) Por tripId del botón
 * 2) Fallback por teléfono (por si el Map se fragmentó o el tripId falló)
 */
export function resolveDriverTrip(
  tripId: string,
  driverPhone: string,
): { trip: Trip | null; source: "tripId" | "driverPhone" | "none" } {
  const trips = getTripsMap();
  const index = getDriverIndex();
  const normalized = normalizePhone(driverPhone);

  let trip = trips.get(tripId);
  let source: "tripId" | "driverPhone" | "none" = trip ? "tripId" : "none";

  console.log("[trip:resolve]", {
    requestedTripId: tripId,
    driverPhone,
    normalizedPhone: normalized,
    foundByTripId: Boolean(trip),
    statusFound: trip?.status ?? null,
    assignedDriverPhone: trip?.assignedDriverPhone ?? null,
    mapSize: trips.size,
  });

  if (trip && !samePhone(trip.assignedDriverPhone, driverPhone)) {
    console.warn("[trip:resolve] phone mismatch on tripId lookup", {
      tripId,
      assignedDriverPhone: trip.assignedDriverPhone,
      driverPhone,
    });
    trip = undefined;
    source = "none";
  }

  if (!trip) {
    const fallbackId = index.get(normalized);
    const fallback = fallbackId ? trips.get(fallbackId) : undefined;

    console.log("[trip:resolve:fallback]", {
      fallbackId: fallbackId ?? null,
      found: Boolean(fallback),
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

function indexDriver(trip: Trip): void {
  if (!trip.assignedDriverPhone) {
    return;
  }
  getDriverIndex().set(normalizePhone(trip.assignedDriverPhone), trip.id);
}

function clearDriverIndex(driverPhone: string | null): void {
  if (!driverPhone) {
    return;
  }
  getDriverIndex().delete(normalizePhone(driverPhone));
}

/** Asigna el viaje al primer conductor. Devuelve null si ya fue tomado. */
export function tryAssignTrip(
  tripId: string,
  driverId: string,
  driverPhone: string,
  driverName: string,
): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    console.warn("[trip:assign:rejected]", {
      tripId,
      driverPhone,
      statusFound: trip?.status ?? null,
    });
    return null;
  }

  const from = trip.status;
  trip.status = "ASSIGNED";
  trip.assignedDriverId = driverId;
  // Guardar el teléfono del webhook (no el de Supabase) para coincidir en clics siguientes.
  trip.assignedDriverPhone = normalizePhone(driverPhone);
  trip.assignedDriverName = driverName;
  trips.set(tripId, trip);
  indexDriver(trip);
  logTransition(trip, from, "ASSIGNED");

  return trip;
}

export function setTripEta(tripId: string, minutes: number): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "ASSIGNED") {
    console.warn("[trip:eta:rejected]", {
      tripId,
      driverPhone: trip?.assignedDriverPhone ?? null,
      statusFound: trip?.status ?? null,
    });
    return null;
  }

  const from = trip.status;
  trip.etaMinutes = minutes;
  trip.status = "ETA_INFORMED";
  trips.set(tripId, trip);
  indexDriver(trip);
  logTransition(trip, from, "ETA_INFORMED");

  return trip;
}

export function markDriverArrived(tripId: string): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "ETA_INFORMED") {
    console.warn("[trip:arrived:rejected]", {
      tripId,
      driverPhone: trip?.assignedDriverPhone ?? null,
      statusFound: trip?.status ?? null,
    });
    return null;
  }

  const from = trip.status;
  trip.status = "DRIVER_ARRIVED";
  trips.set(tripId, trip);
  indexDriver(trip);
  logTransition(trip, from, "DRIVER_ARRIVED");

  return trip;
}

export function startTrip(tripId: string): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "DRIVER_ARRIVED") {
    console.warn("[trip:start:rejected]", {
      tripId,
      driverPhone: trip?.assignedDriverPhone ?? null,
      statusFound: trip?.status ?? null,
    });
    return null;
  }

  const from = trip.status;
  trip.status = "IN_PROGRESS";
  trips.set(tripId, trip);
  indexDriver(trip);
  logTransition(trip, from, "IN_PROGRESS");

  return trip;
}

export function finishTrip(tripId: string): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "IN_PROGRESS") {
    console.warn("[trip:finish:rejected]", {
      tripId,
      driverPhone: trip?.assignedDriverPhone ?? null,
      statusFound: trip?.status ?? null,
    });
    return null;
  }

  const from = trip.status;
  trip.status = "COMPLETED";
  trips.set(tripId, trip);
  clearDriverIndex(trip.assignedDriverPhone);
  logTransition(trip, from, "COMPLETED");

  return trip;
}

export function setTripRating(tripId: string, rating: number): Trip | null {
  const trips = getTripsMap();
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "COMPLETED") {
    return null;
  }

  if (trip.rating !== null) {
    return null;
  }

  trip.rating = rating;
  trips.set(tripId, trip);

  console.log("[trip:rating]", {
    tripId: trip.id,
    driverPhone: trip.assignedDriverPhone,
    rating,
    status: trip.status,
  });

  return trip;
}
