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

const CITY_COLUMNS =
  "id, slug, name, region, country_code, center_lat, center_lng, radius_meters, active";

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
let cachedEnabled: { cities: City[]; loadedAt: number } | null = null;

export function clearActiveCityCache(): void {
  cachedEnabled = null;
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

/**
 * Ciudades habilitadas (`cities.active = true`). Puede haber varias a la vez.
 */
export async function listEnabledCities(): Promise<City[]> {
  if (cachedEnabled && Date.now() - cachedEnabled.loadedAt < CACHE_TTL_MS) {
    return cachedEnabled.cities;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cities")
    .select(CITY_COLUMNS)
    .eq("active", true)
    .order("slug", { ascending: true });

  if (error) {
    console.error("[city] error al listar ciudades habilitadas:", error);
    throw error;
  }

  const cities = ((data ?? []) as CityRow[]).map(mapCity);
  cachedEnabled = { cities, loadedAt: Date.now() };
  return cities;
}

export async function getCityById(id: string): Promise<City | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;

  const fromCache = cachedEnabled?.cities.find((c) => c.id === trimmed);
  if (fromCache) return fromCache;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cities")
    .select(CITY_COLUMNS)
    .eq("id", trimmed)
    .maybeSingle();

  if (error) {
    console.error("[city] error al leer ciudad por id:", error);
    throw error;
  }

  return data ? mapCity(data as CityRow) : null;
}

export async function getCityBySlug(slug: string): Promise<City | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return null;

  const fromCache = cachedEnabled?.cities.find((c) => c.slug === normalized);
  if (fromCache) return fromCache;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("cities")
    .select(CITY_COLUMNS)
    .eq("slug", normalized)
    .maybeSingle();

  if (error) {
    console.error("[city] error al leer ciudad por slug:", error);
    throw error;
  }

  return data ? mapCity(data as CityRow) : null;
}

/**
 * Resolución pura: primera ciudad habilitada cuyo radio contiene el punto.
 * Si hay solape, gana el radio más pequeño.
 */
export function resolveCityFromPointSync(
  point: GeoPoint,
  cities: City[],
): City | null {
  const matches = cities.filter(
    (city) => city.active && isPointInCity(point, city),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches.reduce((a, b) =>
    a.radiusMeters <= b.radiusMeters ? a : b,
  );
}

/** Ciudad habilitada que cubre el punto, o null si está fuera de cobertura. */
export async function resolveCityFromPoint(
  point: GeoPoint,
): Promise<City | null> {
  const cities = await listEnabledCities();
  return resolveCityFromPointSync(point, cities);
}

/**
 * @deprecated Legacy / admin. No usar para trip, dispatch ni tarifa.
 * Con 0 habilitadas lanza. Con 1 devuelve esa. Con N avisa y devuelve la
 * primera por slug (determinista) — no es fuente de verdad operacional.
 */
export async function getActiveCity(): Promise<City> {
  const cities = await listEnabledCities();
  if (cities.length === 0) {
    throw new Error(
      "No hay ciudad habilitada. Aplica las migraciones 017_city_context.sql y 046_multicity_enabled.sql.",
    );
  }
  if (cities.length > 1) {
    console.warn("[city] getActiveCity() es legacy; hay múltiples ciudades habilitadas", {
      slugs: cities.map((c) => c.slug),
      note: "Operación debe usar resolveCityFromPoint / trip.city_id",
    });
  }
  return cities[0];
}

export function outOfCityServiceMessage(city: City): string {
  return `Lo sentimos, por el momento WhatXia solo opera dentro de ${city.name}.`;
}

export function outOfCoverageMessage(): string {
  return "Lo sentimos, por el momento WhatXia no opera en esta zona.";
}

export function sameCityDestinationMessage(city: City): string {
  return `El destino debe estar dentro de ${city.name}.`;
}

export function normalizeCityHint(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Asocia texto de registro a una ciudad habilitada (slug o nombre). No es fuente operacional. */
export function matchCityByHint(hint: string, cities: City[]): City | null {
  const normalized = normalizeCityHint(hint);
  if (!normalized) return null;
  return (
    cities.find(
      (city) =>
        normalizeCityHint(city.slug) === normalized ||
        normalizeCityHint(city.name) === normalized,
    ) ?? null
  );
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
