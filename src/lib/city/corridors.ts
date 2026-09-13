/**
 * Corredor regional de Pasto.
 *
 * Zonas geográficas propias (slug/centro/radio) para pickup y destino.
 * Flota de despacho: solo Pasto (no hay conductores en los satélites).
 * Autorización: malla completa entre pasto, el-tablon, chachagui, tangua,
 * narino y buesaco. Ibagué queda fuera.
 */

import type { GeoPoint } from "@/lib/geo/types";
import {
  buildCityScopedPlaceQuery,
  isPointInCity,
  matchCityByHint,
  resolveCityFromPointSync,
  type City,
} from "@/lib/city/context";

/** Misma constante que pricing.PASTO_CITY_SLUG; no importar pricing (ciclo). */
const PASTO_FLEET_SLUG = "pasto";

export const PASTO_SATELLITE_SLUGS = [
  "tangua",
  "narino",
  "chachagui",
  "buesaco",
  "el-tablon",
] as const;

export type PastoSatelliteSlug = (typeof PASTO_SATELLITE_SLUGS)[number];

export const PASTO_CORRIDOR_SLUGS = [
  PASTO_FLEET_SLUG,
  ...PASTO_SATELLITE_SLUGS,
] as const;

const SATELLITE_SET = new Set<string>(PASTO_SATELLITE_SLUGS);
const CORRIDOR_SET = new Set<string>(PASTO_CORRIDOR_SLUGS);

const BLOCKED_MUNICIPALITY_TYPES = new Set([
  "route",
  "street_address",
  "restaurant",
  "cafe",
  "food",
  "bar",
  "lodging",
  "hotel",
  "store",
  "gas_station",
  "shopping_mall",
  "church",
  "school",
  "hospital",
  "park",
]);

const LOCALITY_TYPES = new Set([
  "locality",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "sublocality",
  "sublocality_level_1",
  "political",
]);

/** Medición Google 2026-09-13 (locality + viewport). No inventada. */
export const PASTO_CORRIDOR_GOOGLE_CITIES = [
  {
    slug: "tangua" as const,
    name: "Tangua",
    region: "Nariño",
    center: { lat: 1.0950573, lng: -77.3939558 },
    radiusMeters: 819,
    googleName: "Tangua",
    googleAddress: "Tangua, Nariño",
  },
  {
    slug: "narino" as const,
    name: "Nariño",
    region: "Nariño",
    center: { lat: 1.2897467, lng: -77.3580033 },
    radiusMeters: 529,
    googleName: "Narino",
    googleAddress: "Narino, Pasto, Nariño",
  },
  {
    slug: "chachagui" as const,
    name: "Chachagüí",
    region: "Nariño",
    center: { lat: 1.359869, lng: -77.282841 },
    radiusMeters: 664,
    googleName: "Chachagüí",
    googleAddress: "Chachagüí, Nariño",
  },
  {
    slug: "buesaco" as const,
    name: "Buesaco",
    region: "Nariño",
    center: { lat: 1.3846384, lng: -77.1562308 },
    radiusMeters: 1540,
    googleName: "Buesaco",
    googleAddress: "Buesaco, Nariño",
  },
  {
    slug: "el-tablon" as const,
    name: "El Tablón",
    region: "Nariño",
    center: { lat: 1.3969246, lng: -77.2915172 },
    radiusMeters: 1450,
    googleName: "Aeropuerto Antonio Nariño",
    googleAddress: "Aeropuerto, Antonio Nariño, Chachagüí, Nariño",
  },
] as const;

/**
 * Puntos Google usados para justificar el radio de El Tablón (no son ciudades).
 * Alex Country House: 1234 m al aeropuerto + viewport 216 m = 1450 m.
 */
export const EL_TABLON_GOOGLE_LANDMARKS = {
  airport: { lat: 1.3969246, lng: -77.2915172 },
  hotelExplora: { lat: 1.3969786, lng: -77.2872635 },
  alexCountryHouse: { lat: 1.3994464, lng: -77.2807063 },
  /** Entre cabecera y aeropuerto: no debe ser el-tablon ni chachagui. */
  sieteColoresRural: { lat: 1.3739665, lng: -77.2846418 },
  /** ~3 km al norte del aeropuerto: fuera de el-tablon, Chachagüí y Pasto. */
  ruralNorthOfAirport: { lat: 1.42388, lng: -77.29152 },
  tablonDeGomez: { lat: 1.427619, lng: -77.097224 },
} as const;

export function isPastoSatelliteSlug(slug: string): boolean {
  return SATELLITE_SET.has(slug.trim().toLowerCase());
}

export function isPastoCorridorSlug(slug: string): boolean {
  return CORRIDOR_SET.has(slug.trim().toLowerCase());
}

/** Malla completa del corredor regional. Ibagué no entra. */
export function isAuthorizedCorridorPair(
  originSlug: string,
  destinationSlug: string,
): boolean {
  const origin = originSlug.trim().toLowerCase();
  const destination = destinationSlug.trim().toLowerCase();
  if (origin === destination) return true;
  return CORRIDOR_SET.has(origin) && CORRIDOR_SET.has(destination);
}

export function isAllowedDropoffPoint(
  origin: City,
  point: GeoPoint,
  cities: City[],
): boolean {
  if (isPointInCity(point, origin)) return true;
  const destination = resolveCityFromPointSync(point, cities);
  if (!destination) return false;
  return isAuthorizedCorridorPair(origin.slug, destination.slug);
}

export function filterCandidatesForDropoff<T extends { location: GeoPoint }>(
  candidates: T[],
  origin: City,
  cities: City[],
): T[] {
  return candidates.filter((candidate) =>
    isAllowedDropoffPoint(origin, candidate.location, cities),
  );
}

/**
 * Satélites no tienen flota. El despacho del corredor usa Pasto.
 * Ibagué y cualquier ciudad fuera del corredor despachan su propio city_id.
 */
export function dispatchFleetCity(origin: City, cities: City[]): City {
  if (!isPastoCorridorSlug(origin.slug)) return origin;
  const pasto = cities.find((city) => city.slug === PASTO_FLEET_SLUG);
  return pasto ?? origin;
}

/**
 * Destinos desde un satélite (el-tablon, etc.) se buscan en Pasto.
 * Si no, "Único Outlet" se convertía en "…, El Tablón, Nariño" y Google
 * no devolvía el centro comercial de Pasto.
 */
export function dropoffSearchScopeCity(origin: City, cities: City[]): City {
  if (!isPastoSatelliteSlug(origin.slug)) return origin;
  return cities.find((city) => city.slug === PASTO_FLEET_SLUG) ?? origin;
}

/**
 * trip.city_id operacional: satélites del corredor persisten Pasto
 * (misma flota, aislamiento y reportes). La cobertura geográfica sigue
 * resolviendo el-tablon/chachagui/etc. para pickup y destino.
 */
export function operationalTripCity(origin: City, cities: City[]): City {
  return dispatchFleetCity(origin, cities);
}

export function driverServesOriginCity(
  origin: City,
  driverCity: City,
): boolean {
  if (isPastoCorridorSlug(origin.slug)) {
    return driverCity.slug === PASTO_FLEET_SLUG;
  }
  return origin.id === driverCity.id;
}

/** Registro de conductor: Tangua/etc. se asocian a la flota Pasto. */
export function matchDriverFleetCity(
  hint: string,
  cities: City[],
): City | null {
  const matched = matchCityByHint(hint, cities);
  if (!matched) return null;
  if (isPastoSatelliteSlug(matched.slug)) {
    return cities.find((city) => city.slug === PASTO_FLEET_SLUG) ?? matched;
  }
  return matched;
}

export function dropoffNotAllowedMessage(origin: City): string {
  if (isPastoCorridorSlug(origin.slug)) {
    return `El destino debe estar en una zona del corredor de Pasto (Pasto, El Tablón, Chachagüí, Tangua, Nariño o Buesaco).`;
  }
  return `El destino debe estar dentro de ${origin.name}.`;
}

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function normalizePlaceText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function aliasMunicipalitySlug(normalizedQuery: string): string | null {
  if (normalizedQuery.includes("gomez") && normalizedQuery.includes("tablon")) {
    return null;
  }
  if (
    normalizedQuery === "el tablon" ||
    normalizedQuery === "el-tablon" ||
    normalizedQuery.startsWith("el tablon,") ||
    normalizedQuery.startsWith("el-tablon,")
  ) {
    return "el-tablon";
  }
  if (
    normalizedQuery.includes("aeropuerto antonio narino") ||
    normalizedQuery.includes("aeropuerto nva") ||
    normalizedQuery === "nva"
  ) {
    return "el-tablon";
  }
  return null;
}

export function matchMunicipalityCity(
  query: string,
  cities: City[],
): City | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const aliasSlug = aliasMunicipalitySlug(normalizePlaceText(trimmed));
  if (aliasSlug) {
    const aliased = cities.find((city) => city.slug === aliasSlug);
    if (aliased) return aliased;
  }
  const direct = matchCityByHint(trimmed, cities);
  if (direct) return direct;
  const head = trimmed.split(",")[0]?.trim() ?? "";
  return matchCityByHint(head, cities);
}

/**
 * Si el usuario nombra un municipio, no sesgar con la ciudad de origen
 * ("Chachagüí, Pasto, Nariño" devolvía la carretera).
 * El Tablón no se busca como "El Tablón, Nariño" (Google devuelve Gómez).
 */
export function buildDropoffPlaceQuery(
  userQuery: string,
  origin: City,
  cities: City[],
): string {
  const matched = matchMunicipalityCity(userQuery, cities);
  if (matched?.slug === "el-tablon") {
    return "Aeropuerto Antonio Nariño, Chachagüí, Nariño";
  }
  if (matched) {
    return `${matched.name}, ${matched.region}`;
  }
  return buildCityScopedPlaceQuery(
    userQuery,
    dropoffSearchScopeCity(origin, cities),
  );
}

export function corridorSearchBiasMeters(
  origin: City,
  cities: City[],
): number {
  if (!isPastoCorridorSlug(origin.slug)) return origin.radiusMeters;
  let max = origin.radiusMeters;
  for (const city of cities) {
    if (!isPastoCorridorSlug(city.slug)) continue;
    const cover = haversineMeters(origin.center, city.center) + city.radiusMeters;
    if (cover > max) max = cover;
  }
  return Math.min(50_000, Math.ceil(max));
}

export function placeSearchBiasCircle(
  origin: City,
  query: string,
  cities: City[],
): { slug: string; center: GeoPoint; radiusMeters: number } {
  const matched = matchMunicipalityCity(query, cities);
  if (matched && isAuthorizedCorridorPair(origin.slug, matched.slug)) {
    return {
      slug: matched.slug,
      center: matched.center,
      radiusMeters: matched.radiusMeters,
    };
  }
  if (isPastoCorridorSlug(origin.slug)) {
    const scope = dropoffSearchScopeCity(origin, cities);
    return {
      slug: scope.slug,
      center: scope.center,
      radiusMeters: corridorSearchBiasMeters(scope, cities),
    };
  }
  return {
    slug: origin.slug,
    center: origin.center,
    radiusMeters: origin.radiusMeters,
  };
}

export function placeSearchBiasCity(
  origin: City,
  query: string,
  cities: City[],
): City {
  const matched = matchMunicipalityCity(query, cities);
  if (
    matched &&
    isAuthorizedCorridorPair(origin.slug, matched.slug)
  ) {
    return matched;
  }
  return origin;
}

type TypedPlace = {
  name: string;
  address?: string;
  location?: GeoPoint;
  types?: string[];
  primaryType?: string | null;
};

function placeTypes(place: TypedPlace): string[] {
  const types = [...(place.types ?? [])];
  if (place.primaryType) types.unshift(place.primaryType);
  return types;
}

function isLocalityPlace(place: TypedPlace): boolean {
  return placeTypes(place).some((type) => LOCALITY_TYPES.has(type));
}

function isBlockedMunicipalityPlace(place: TypedPlace): boolean {
  const types = placeTypes(place);
  const blocked = types.some((type) => BLOCKED_MUNICIPALITY_TYPES.has(type));
  if (!blocked) return false;
  return !isLocalityPlace(place) || types.includes("route") || types.includes("restaurant");
}

/**
 * Si el texto es un municipio, descarta carreteras y POI (restaurantes, etc.)
 * y conserva la localidad homónima.
 */
export function preferMunicipalityPlaces<T extends TypedPlace>(
  query: string,
  candidates: T[],
  cities: City[],
): T[] {
  const matched = matchMunicipalityCity(query, cities);
  if (!matched || candidates.length === 0) return candidates;

  const inZone = candidates.filter(
    (place) => place.location && isPointInCity(place.location, matched),
  );
  const pool = inZone.length > 0 ? inZone : [];
  if (pool.length === 0) return [];

  const localities = pool.filter((place) => {
    const types = placeTypes(place);
    return (
      (isLocalityPlace(place) || types.includes("airport")) &&
      !types.includes("route") &&
      !types.includes("restaurant") &&
      !types.includes("cafe")
    );
  });
  if (localities.length > 0) return localities;

  const notBlocked = pool.filter((place) => !isBlockedMunicipalityPlace(place));
  return notBlocked;
}
