import { getSupabase } from "@/lib/supabase/client";
import type { GeoPoint } from "@/lib/geo/types";

export type City = {
  id: string;
  slug: string;
  name: string;
  region: string;
  countryCode: string;
  center: GeoPoint;
  radiusMeters: number;
  active: boolean;
};

type CityRow = {
  id: string;
  slug: string;
  name: string;
  region: string;
  country_code: string;
  center_lat: number;
  center_lng: number;
  radius_meters: number;
  active: boolean;
};

function mapCity(row: CityRow): City {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    region: row.region,
    countryCode: row.country_code,
    center: { lat: row.center_lat, lng: row.center_lng },
    radiusMeters: row.radius_meters,
    active: row.active,
  };
}

const CACHE_TTL_MS = 60_000;
let cached: { city: City; loadedAt: number } | null = null;

export function clearActiveCityCache(): void {
  cached = null;
}

/**
 * Ciudad de operación activa (por ahora Ibagué).
 */
export async function getActiveCity(): Promise<City> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.city;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cities")
    .select(
      "id, slug, name, region, country_code, center_lat, center_lng, radius_meters, active",
    )
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("[city] error al leer ciudad activa:", error);
    throw error;
  }

  if (!data) {
    throw new Error(
      "No hay ciudad activa. Aplica la migración 017_city_context.sql.",
    );
  }

  const city = mapCity(data as CityRow);
  cached = { city, loadedAt: Date.now() };
  return city;
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** ¿El punto está dentro del radio de operación de la ciudad? */
export function isPointInCity(point: GeoPoint, city: City): boolean {
  return haversineMeters(point, city.center) <= city.radiusMeters;
}

export function outOfCityServiceMessage(city: City): string {
  return `Lo sentimos, por el momento WhatXia solo opera dentro de ${city.name}.`;
}

/**
 * Enriquece la query de Places con ciudad/región para priorizar
 * resultados locales (ej. "Gobernación" → Gobernación del Tolima).
 */
export function buildCityScopedPlaceQuery(
  userQuery: string,
  city: City,
): string {
  const trimmed = userQuery.trim();
  const lower = trimmed.toLowerCase();
  const cityLower = city.name.toLowerCase();
  const regionLower = city.region.toLowerCase();

  if (lower.includes(cityLower) || lower.includes(regionLower)) {
    return trimmed;
  }

  return `${trimmed}, ${city.name}, ${city.region}`;
}

export function filterCandidatesInCity<T extends { location: GeoPoint }>(
  candidates: T[],
  city: City,
): T[] {
  return candidates.filter((c) => isPointInCity(c.location, city));
}
