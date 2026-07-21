export type TripStatus = "SEARCHING" | "ASSIGNED";

export type Trip = {
  id: string;
  passengerPhone: string;
  pickupNeighborhood: string;
  status: TripStatus;
  assignedDriverId: string | null;
  assignedDriverPhone: string | null;
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
): Trip | null {
  const trip = trips.get(tripId);

  if (!trip || trip.status !== "SEARCHING") {
    return null;
  }

  trip.status = "ASSIGNED";
  trip.assignedDriverId = driverId;
  trip.assignedDriverPhone = driverPhone;
  trips.set(tripId, trip);

  return trip;
}
