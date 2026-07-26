/**
 * Persistencia de recorridos favoritos (origen + destino).
 * Límite: MAX_ROUTE_FAVORITES por pasajero.
 */

import { getSupabase } from "@/lib/supabase/client";
import type { Trip } from "@/lib/trips";

export const MAX_ROUTE_FAVORITES = 2;

export type RouteFavorite = {
  id: string;
  passengerId: string;
  name: string;
  pickupLat: number;
  pickupLng: number;
  pickupLabel: string;
  pickupPlaceId: string | null;
  dropoffLat: number;
  dropoffLng: number;
  dropoffLabel: string;
  dropoffPlaceId: string | null;
  tripId: string | null;
  createdAt: string;
  updatedAt: string;
};

type RouteFavoriteRow = {
  id: string;
  passenger_id: string;
  name: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_label: string;
  pickup_place_id: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_label: string;
  dropoff_place_id: string | null;
  trip_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: RouteFavoriteRow): RouteFavorite {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    name: row.name,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    pickupLabel: row.pickup_label,
    pickupPlaceId: row.pickup_place_id,
    dropoffLat: row.dropoff_lat,
    dropoffLng: row.dropoff_lng,
    dropoffLabel: row.dropoff_label,
    dropoffPlaceId: row.dropoff_place_id,
    tripId: row.trip_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS =
  "id, passenger_id, name, pickup_lat, pickup_lng, pickup_label, pickup_place_id, dropoff_lat, dropoff_lng, dropoff_label, dropoff_place_id, trip_id, created_at, updated_at";

export function tripHasCompleteRoute(trip: Trip): boolean {
  return (
    trip.pickupLat != null &&
    trip.pickupLng != null &&
    trip.dropoffLat != null &&
    trip.dropoffLng != null
  );
}

export async function listRouteFavorites(
  passengerId: string,
): Promise<RouteFavorite[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("route_favorites")
    .select(COLUMNS)
    .eq("passenger_id", passengerId)
    .order("updated_at", { ascending: false })
    .limit(MAX_ROUTE_FAVORITES);

  if (error) {
    console.error("[route-favorites] error al listar:", error);
    throw error;
  }

  return ((data ?? []) as RouteFavoriteRow[]).map(mapRow);
}

export async function countRouteFavorites(
  passengerId: string,
): Promise<number> {
  const supabase = getSupabase();

  const { count, error } = await supabase
    .from("route_favorites")
    .select("id", { count: "exact", head: true })
    .eq("passenger_id", passengerId);

  if (error) {
    console.error("[route-favorites] error al contar:", error);
    throw error;
  }

  return count ?? 0;
}

export type CreateRouteFavoriteInput = {
  passengerId: string;
  name: string;
  trip: Trip;
};

export async function createRouteFavorite(
  input: CreateRouteFavoriteInput,
): Promise<RouteFavorite | null> {
  const { passengerId, name, trip } = input;

  if (!tripHasCompleteRoute(trip)) {
    return null;
  }

  const existing = await countRouteFavorites(passengerId);
  if (existing >= MAX_ROUTE_FAVORITES) {
    return null;
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const trimmedName = name.trim().slice(0, 40);

  const { data, error } = await supabase
    .from("route_favorites")
    .insert({
      passenger_id: passengerId,
      name: trimmedName,
      pickup_lat: trip.pickupLat,
      pickup_lng: trip.pickupLng,
      pickup_label:
        trip.pickupLabel?.trim() ||
        trip.pickupNeighborhood?.trim() ||
        "Origen",
      pickup_place_id: trip.pickupPlaceId,
      dropoff_lat: trip.dropoffLat,
      dropoff_lng: trip.dropoffLng,
      dropoff_label: trip.dropoffLabel?.trim() || "Destino",
      dropoff_place_id: trip.dropoffPlaceId,
      trip_id: trip.id,
      created_at: now,
      updated_at: now,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    console.error("[route-favorites] error al crear:", error);
    throw error;
  }

  return mapRow(data as RouteFavoriteRow);
}
