/**
 * Persistencia y lectura de calificaciones para reputación.
 * - Conductor ← trips.rating (pasajero califica)
 * - Pasajero ← passenger_ratings (conductor califica)
 */

import { getSupabase } from "@/lib/supabase/client";
import {
  computeAverage,
  emptyRatingAggregate,
  type RatingAggregate,
} from "@/lib/reputation/average";

const ALLOWED_RATINGS = new Set([5, 4, 2]);

export type CreatePassengerRatingInput = {
  tripId: string;
  driverId: string;
  passengerId: string;
  rating: number;
};

export type PassengerRatingRow = {
  id: string;
  tripId: string;
  driverId: string;
  passengerId: string;
  rating: number;
  createdAt: string;
};

export async function getDriverRatingAggregate(
  driverId: string,
): Promise<RatingAggregate> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trips")
    .select("rating")
    .eq("driver_id", driverId)
    .eq("status", "COMPLETED")
    .not("rating", "is", null);

  if (error) {
    console.error("[reputation] error al leer calificaciones del conductor:", error);
    throw error;
  }

  const ratings = (data ?? [])
    .map((row) => row.rating as number | null)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  return computeAverage(ratings);
}

export async function getPassengerRatingAggregate(
  passengerId: string,
): Promise<RatingAggregate> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("passenger_ratings")
    .select("rating")
    .eq("passenger_id", passengerId);

  if (error) {
    console.error("[reputation] error al leer calificaciones del pasajero:", error);
    throw error;
  }

  const ratings = (data ?? [])
    .map((row) => row.rating as number | null)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  return computeAverage(ratings);
}

export async function getPassengerRatingByTripId(
  tripId: string,
): Promise<PassengerRatingRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("passenger_ratings")
    .select("id, trip_id, driver_id, passenger_id, rating, created_at")
    .eq("trip_id", tripId)
    .maybeSingle();

  if (error) {
    console.error("[reputation] error al leer calificación por viaje:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id as string,
    tripId: data.trip_id as string,
    driverId: data.driver_id as string,
    passengerId: data.passenger_id as string,
    rating: data.rating as number,
    createdAt: data.created_at as string,
  };
}

export async function createPassengerRating(
  input: CreatePassengerRatingInput,
): Promise<PassengerRatingRow | null> {
  if (!ALLOWED_RATINGS.has(input.rating)) {
    return null;
  }

  const existing = await getPassengerRatingByTripId(input.tripId);
  if (existing) {
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("passenger_ratings")
    .insert({
      trip_id: input.tripId,
      driver_id: input.driverId,
      passenger_id: input.passengerId,
      rating: input.rating,
    })
    .select("id, trip_id, driver_id, passenger_id, rating, created_at")
    .single();

  if (error) {
    // Unique violation: ya calificado
    if ((error as { code?: string }).code === "23505") {
      return null;
    }
    console.error("[reputation] error al guardar calificación del pasajero:", error);
    throw error;
  }

  return {
    id: data.id as string,
    tripId: data.trip_id as string,
    driverId: data.driver_id as string,
    passengerId: data.passenger_id as string,
    rating: data.rating as number,
    createdAt: data.created_at as string,
  };
}

/** Resuelve agregado; si no hay passengerId, retorna vacío (usuario nuevo). */
export async function getPassengerRatingAggregateSafe(
  passengerId: string | null | undefined,
): Promise<RatingAggregate> {
  if (!passengerId) {
    return emptyRatingAggregate();
  }
  return getPassengerRatingAggregate(passengerId);
}
