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

const trips = new Map<string, Trip>();

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

  trips.set(trip.id, trip);
  return trip;
}

export function getTrip(tripId: string): Trip | undefined {
  return trips.get(tripId);
}

/** Asigna el viaje al primer conductor. Devuelve null si ya fue tomado. */
export function tryAssignTrip(
  tripId: string,
  driverId: string,
  driverPhone: string,
  driverName: string,
): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    return null;
  }

  trip.status = "ASSIGNED";
  trip.assignedDriverId = driverId;
  trip.assignedDriverPhone = driverPhone;
  trip.assignedDriverName = driverName;
  trips.set(tripId, trip);

  return trip;
}

export function setTripEta(tripId: string, minutes: number): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "ASSIGNED") {
    return null;
  }

  trip.etaMinutes = minutes;
  trip.status = "ETA_INFORMED";
  trips.set(tripId, trip);

  return trip;
}

export function markDriverArrived(tripId: string): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "ETA_INFORMED") {
    return null;
  }

  trip.status = "DRIVER_ARRIVED";
  trips.set(tripId, trip);

  return trip;
}

export function startTrip(tripId: string): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "DRIVER_ARRIVED") {
    return null;
  }

  trip.status = "IN_PROGRESS";
  trips.set(tripId, trip);

  return trip;
}

export function finishTrip(tripId: string): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "IN_PROGRESS") {
    return null;
  }

  trip.status = "COMPLETED";
  trips.set(tripId, trip);

  return trip;
}

export function setTripRating(tripId: string, rating: number): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "COMPLETED") {
    return null;
  }

  if (trip.rating !== null) {
    return null;
  }

  trip.rating = rating;
  trips.set(tripId, trip);

  return trip;
}
