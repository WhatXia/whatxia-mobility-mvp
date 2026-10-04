/**
 * Servicios que un conductor puede ver en la app.
 * La elegibilidad es la de publishTripOffer: no hay un segundo filtro.
 */

import { resolveOfferOrigin } from "@/lib/booking/intent";
import { listEligibleDriversForTripOffer } from "@/lib/dispatch";
import { findDriverByPhone, type DriverRow } from "@/lib/supabase/drivers";
import { listSearchingTrips, type Trip } from "@/lib/trips";

export type DriverServiceCard = {
  trip_id: string;
  pickup_label: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_label: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  quoted_fare: number | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  created_at: string | null;
};

function toServiceCard(trip: Trip): DriverServiceCard {
  const dropoff = trip.dropoffLabel?.trim() ?? "";

  return {
    trip_id: trip.id,
    pickup_label: resolveOfferOrigin(trip.pickupNeighborhood, trip.pickupLabel),
    pickup_lat: trip.pickupLat,
    pickup_lng: trip.pickupLng,
    dropoff_label: dropoff.length > 0 ? dropoff : null,
    dropoff_lat: trip.dropoffLat,
    dropoff_lng: trip.dropoffLng,
    quoted_fare: trip.quotedFare,
    distance_meters: trip.distanceMeters,
    duration_seconds: trip.durationSeconds,
    created_at: trip.createdAt,
  };
}

/**
 * Viajes SEARCHING cuya audiencia de oferta incluye a este conductor.
 * Si no está disponible, no hay servicios: listAvailableDrivers tampoco lo ofrecería.
 */
export async function listAvailableServicesForDriver(
  driver: DriverRow,
): Promise<DriverServiceCard[]> {
  if (!driver.is_available || driver.status !== "active") {
    return [];
  }

  const trips = await listSearchingTrips();
  const services: DriverServiceCard[] = [];

  for (const trip of trips) {
    const passengerDriver = await findDriverByPhone(trip.passengerPhone);
    const eligible = await listEligibleDriversForTripOffer(trip, {
      excludePhone: trip.passengerPhone,
      excludeDriverId: passengerDriver?.id,
      quiet: true,
    });

    if (eligible.drivers.some((candidate) => candidate.id === driver.id)) {
      services.push(toServiceCard(trip));
    }
  }

  return services;
}
