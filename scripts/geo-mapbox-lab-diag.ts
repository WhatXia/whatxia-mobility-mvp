/**
 * Laboratorio aislado: Google Places/Routes vs Mapbox Search Box/Directions.
 *
 * SOLO local. No es proveedor activo. No escribe en Supabase, WhatsApp,
 * Vercel, trips ni favoritos. No define GEO_PROVIDER.
 *
 * Uso:
 *   npx tsx scripts/geo-mapbox-lab-diag.ts
 *
 * Env:
 *   GOOGLE_MAPS_API_KEY
 *   MAPBOX_ACCESS_TOKEN  (si falta → SKIPPED_NO_TOKEN)
 */
export {};

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCityScopedPlaceQuery,
  filterCandidatesInCity,
  isPointInCity,
  type City,
} from "@/lib/city/context";
import {
  isHighConfidenceMatch,
  rankPlaceCandidates,
  topCandidates,
} from "@/lib/geo/confidence";
import { GOOGLE_FETCH_TIMEOUT_MS } from "@/lib/geo/config";
import { circleToViewportRectangle } from "@/lib/geo/places";
import { parseRoutesResponse } from "@/lib/geo/routes";
import type { GeoPoint, PlaceCandidate } from "@/lib/geo/types";

const PAUSE_MS = 200;
const DIST_ALERT_PCT = 10;
const DUR_ALERT_PCT = 15;
const SEARCH_LIMIT = 8;

/** Constantes Ibagué (seed/certify). No llama estimateFare. */
const IBAGUE_MIN_DISTANCE_M = 1600;
const IBAGUE_INCREMENT_M = 80;
const IBAGUE_INCREMENT_COP = 90;
const IBAGUE_MINIMUM_FARE = 6600;

const IBAGUE: City = {
  id: "lab-ibague",
  slug: "ibague",
  name: "Ibagué",
  region: "Tolima",
  countryCode: "CO",
  center: { lat: 4.4389, lng: -75.2322 },
  radiusMeters: 18000,
  active: true,
};

const PASTO: City = {
  id: "lab-pasto",
  slug: "pasto",
  name: "Pasto",
  region: "Nariño",
  countryCode: "CO",
  center: { lat: 1.2136, lng: -77.2811 },
  radiusMeters: 20000,
  active: true,
};

/** Coords en repo (migraciones / certify). No inventadas. */
const SEED = {
  ibagueCenter: IBAGUE.center,
  perales: { lat: 4.4214, lng: -75.1333 },
  pastoCenter: PASTO.center,
  antonioNarinoAirport: { lat: 1.3964, lng: -77.2915 },
} as const;

type LabSearchRow = {
  id: string;
  userQuery: string;
  biasCity: City;
  kind: string;
  expected: string;
};

const SEARCH_BANK: LabSearchRow[] = [
  {
    id: "IB-POI-01",
    userQuery: "Gobernación",
    biasCity: IBAGUE,
    kind: "referencia",
    expected: "Gobernación del Tolima en Ibagué",
  },
  {
    id: "IB-POI-02",
    userQuery: "Multicentro",
    biasCity: IBAGUE,
    kind: "centro_comercial",
    expected: "Multicentro Ibagué",
  },
  {
    id: "IB-POI-03",
    userQuery: "Terminal",
    biasCity: IBAGUE,
    kind: "terminal",
    expected: "Terminal de transportes Ibagué",
  },
  {
    id: "IB-POI-04",
    userQuery: "Aeropuerto",
    biasCity: IBAGUE,
    kind: "aeropuerto",
    expected: "Aeropuerto Perales",
  },
  {
    id: "IB-POI-05",
    userQuery: "Plaza de Bolívar",
    biasCity: IBAGUE,
    kind: "referencia",
    expected: "Plaza de Bolívar Ibagué",
  },
  {
    id: "IB-BAR-01",
    userQuery: "Florida 4",
    biasCity: IBAGUE,
    kind: "barrio",
    expected: "Barrio Florida 4 Ibagué",
  },
  {
    id: "IB-BAR-02",
    userQuery: "La Pola",
    biasCity: IBAGUE,
    kind: "barrio",
    expected: "Barrio La Pola Ibagué",
  },
  {
    id: "IB-BAR-03",
    userQuery: "El Jordán",
    biasCity: IBAGUE,
    kind: "barrio",
    expected: "El Jordán Ibagué",
  },
  {
    id: "IB-BAR-04",
    userQuery: "Las Américas",
    biasCity: IBAGUE,
    kind: "barrio_ambiguo",
    expected: "Las Américas Ibagué (no Bogotá)",
  },
  {
    id: "IB-DIR-01",
    userQuery: "Carrera 4 # 32-1, La Pola",
    biasCity: IBAGUE,
    kind: "nomenclatura",
    expected: "Dirección en La Pola Ibagué",
  },
  {
    id: "IB-DIR-02",
    userQuery: "El Jordán, Octava Etapa, Manzana 23, Casa 1",
    biasCity: IBAGUE,
    kind: "manzana_casa",
    expected: "Zona El Jordán Ibagué",
  },
  {
    id: "IB-AMB-01",
    userQuery: "Centro",
    biasCity: IBAGUE,
    kind: "ambiguo",
    expected: "Centro de Ibagué",
  },
  {
    id: "IB-AMB-02",
    userQuery: "Éxito",
    biasCity: IBAGUE,
    kind: "establecimiento_ambiguo",
    expected: "Éxito en Ibagué",
  },
  {
    id: "IB-NEG-01",
    userQuery: "Parque 93",
    biasCity: IBAGUE,
    kind: "negativo",
    expected: "No debería ganar Bogotá; fuera de radio o irrelevante",
  },
  {
    id: "PA-POI-01",
    userQuery: "Plaza de Nariño",
    biasCity: PASTO,
    kind: "referencia",
    expected: "Plaza de Nariño / centro de Pasto",
  },
  {
    id: "PA-POI-02",
    userQuery: "Terminal",
    biasCity: PASTO,
    kind: "terminal",
    expected: "Terminal de Pasto",
  },
  {
    id: "PA-POI-03",
    userQuery: "Centro",
    biasCity: PASTO,
    kind: "ambiguo",
    expected: "Centro de Pasto, no Ibagué",
  },
  {
    id: "PA-POI-04",
    userQuery: "Aeropuerto",
    biasCity: PASTO,
    kind: "aeropuerto",
    expected: "Antonio Nariño (posible fuera de radio 20 km)",
  },
  {
    id: "PA-BAR-01",
    userQuery: "San Ignacio",
    biasCity: PASTO,
    kind: "barrio",
    expected: "Barrio San Ignacio Pasto si el proveedor lo conoce",
  },
  {
    id: "PA-BAR-02",
    userQuery: "El Tejar",
    biasCity: PASTO,
    kind: "barrio",
    expected: "Barrio El Tejar Pasto si el proveedor lo conoce",
  },
  {
    id: "PA-DIR-01",
    userQuery: "Carrera 25 # 17-21",
    biasCity: PASTO,
    kind: "nomenclatura",
    expected: "Nomenclatura colombiana en Pasto",
  },
  {
    id: "NR-CHA-01",
    userQuery: "Chachagui, Nariño",
    biasCity: PASTO,
    kind: "municipio",
    expected: "Municipio o aeropuerto; coords solo si la API las devuelve",
  },
  {
    id: "NR-CHA-02",
    userQuery: "Aeropuerto Antonio Nariño",
    biasCity: PASTO,
    kind: "aeropuerto",
    expected: "POI aeropuerto vs pueblo Chachagüí",
  },
  {
    id: "NR-BUE-01",
    userQuery: "Buesaco, Nariño",
    biasCity: PASTO,
    kind: "municipio",
    expected: "Pueblo Buesaco; no inventar coords",
  },
  {
    id: "NR-TAN-01",
    userQuery: "Tangua, Nariño",
    biasCity: PASTO,
    kind: "municipio",
    expected: "Pueblo Tangua; no inventar coords",
  },
];

type SeedRoute = {
  id: string;
  origin: GeoPoint;
  destination: GeoPoint;
  originLabel: string;
  destLabel: string;
  coordSource: string;
  fareCity: "ibague" | "pasto" | "none";
};

const SEED_ROUTES: SeedRoute[] = [
  {
    id: "RT-IB-01",
    origin: SEED.ibagueCenter,
    destination: SEED.perales,
    originLabel: "Centro Ibagué",
    destLabel: "Aeropuerto Perales",
    coordSource: "repo:017_city_context+fare_rules",
    fareCity: "ibague",
  },
  {
    id: "RT-PA-01",
    origin: SEED.pastoCenter,
    destination: SEED.antonioNarinoAirport,
    originLabel: "Centro Pasto",
    destLabel: "Aeropuerto Antonio Nariño (fixture certify)",
    coordSource: "repo:046_cities+multicity.certify airport fixture",
    fareCity: "pasto",
  },
  {
    id: "RT-XX-01",
    origin: SEED.ibagueCenter,
    destination: SEED.pastoCenter,
    originLabel: "Centro Ibagué",
    destLabel: "Centro Pasto",
    coordSource: "repo:city centers (control intercity; el Bot no cotiza esto)",
    fareCity: "none",
  },
];

type DerivedRouteSpec = {
  id: string;
  originSearchId: string | null;
  destSearchId: string | null;
  originSeed?: GeoPoint;
  destSeed?: GeoPoint;
  originLabel: string;
  destLabel: string;
  fareCity: "ibague" | "pasto" | "none";
  allowOutsideCity: boolean;
};

const DERIVED_ROUTES: DerivedRouteSpec[] = [
  {
    id: "RT-IB-D01",
    originSearchId: "IB-POI-01",
    destSearchId: "IB-POI-03",
    originLabel: "Gobernación (búsqueda)",
    destLabel: "Terminal Ibagué (búsqueda)",
    fareCity: "ibague",
    allowOutsideCity: false,
  },
  {
    id: "RT-IB-D02",
    originSearchId: "IB-POI-02",
    destSearchId: "IB-POI-05",
    originLabel: "Multicentro (búsqueda)",
    destLabel: "Plaza de Bolívar (búsqueda)",
    fareCity: "ibague",
    allowOutsideCity: false,
  },
  {
    id: "RT-IB-D03",
    originSearchId: "IB-DIR-01",
    destSearchId: null,
    destSeed: SEED.ibagueCenter,
    originLabel: "Cra 4 # 32-1 La Pola (búsqueda)",
    destLabel: "Centro Ibagué (repo)",
    fareCity: "ibague",
    allowOutsideCity: false,
  },
  {
    id: "RT-PA-D01",
    originSearchId: "PA-POI-02",
    destSearchId: "PA-POI-01",
    originLabel: "Terminal Pasto (búsqueda)",
    destLabel: "Plaza de Nariño (búsqueda)",
    fareCity: "pasto",
    allowOutsideCity: false,
  },
  {
    id: "RT-NR-CHA",
    originSearchId: null,
    originSeed: SEED.pastoCenter,
    destSearchId: "NR-CHA-01",
    originLabel: "Centro Pasto (repo)",
    destLabel: "Chachagüí (solo si la API devuelve coords)",
    fareCity: "none",
    allowOutsideCity: true,
  },
  {
    id: "RT-NR-BUE",
    originSearchId: null,
    originSeed: SEED.pastoCenter,
    destSearchId: "NR-BUE-01",
    originLabel: "Centro Pasto (repo)",
    destLabel: "Buesaco (solo si la API devuelve coords)",
    fareCity: "none",
    allowOutsideCity: true,
  },
  {
    id: "RT-NR-TAN",
    originSearchId: null,
    originSeed: SEED.pastoCenter,
    destSearchId: "NR-TAN-01",
    originLabel: "Centro Pasto (repo)",
    destLabel: "Tangua (solo si la API devuelve coords)",
    fareCity: "none",
    allowOutsideCity: true,
  },
];

type ProviderStatus =
  | "ok"
  | "SKIPPED_NO_GOOGLE_KEY"
  | "SKIPPED_NO_TOKEN"
  | "SKIPPED_SEARCHBOX_UNAVAILABLE"
  | "SKIPPED_DIRECTIONS_UNAVAILABLE"
  | "SKIPPED_NO_COORDS"
  | "error";

type LabCandidate = {
  name: string;
  address: string;
  location: GeoPoint;
  placeId: string;
  featureType: string;
  confidenceScore: number;
  inBiasCity: boolean;
  metersToBiasCenter: number;
};

type SearchProviderResult = {
  status: ProviderStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  queryUsed: string;
  rawCount: number;
  inCityCount: number;
  rejectedOutsideCity: number;
  candidates: LabCandidate[];
  botAutoAccept: boolean | null;
  botTop3: Array<{ name: string; address: string }>;
  error: string | null;
};

type SearchCaseResult = {
  id: string;
  userQuery: string;
  kind: string;
  expected: string;
  biasCity: string;
  google: SearchProviderResult;
  mapbox: SearchProviderResult;
};

type RouteProviderResult = {
  status: ProviderStatus;
  profile: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  latencyMs: number | null;
  httpStatus: number | null;
  error: string | null;
};

type RouteCaseResult = {
  id: string;
  originLabel: string;
  destLabel: string;
  origin: GeoPoint | null;
  destination: GeoPoint | null;
  coordSource: string;
  fareCity: "ibague" | "pasto" | "none";
  inPastoRadiusOrigin: boolean | null;
  inPastoRadiusDest: boolean | null;
  google: RouteProviderResult;
  mapbox: RouteProviderResult;
  distDeltaPct: number | null;
  durDeltaPct: number | null;
  alertDist: boolean;
  alertDur: boolean;
  ibagueGoogleCop: number | null;
  ibagueMapboxCop: number | null;
  ibagueCopDelta: number | null;
};

type LabReport = {
  ranAt: string;
  mode: "laboratorio_local";
  productionProvider: "google";
  geoProviderFlag: null;
  keys: {
    GOOGLE_MAPS_API_KEY: boolean;
    MAPBOX_ACCESS_TOKEN: boolean;
  };
  mapboxSearchBox: "unknown" | "ok" | "SKIPPED_NO_TOKEN" | "SKIPPED_SEARCHBOX_UNAVAILABLE";
  searches: SearchCaseResult[];
  routes: RouteCaseResult[];
  coverage: Array<{
    place: string;
    isBotCity: boolean;
    coordsInRepo: boolean;
    googleHits: number | null;
    mapboxHits: number | null;
    firstCoord: GeoPoint | null;
    coordSource: string | null;
    metersToPastoCenter: number | null;
    inPastoRadius: boolean | null;
  }>;
};

function loadLabEnv(): void {
  const allowed = new Set(["GOOGLE_MAPS_API_KEY", "MAPBOX_ACCESS_TOKEN"]);
  let raw = "";
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (!allowed.has(name)) continue;
    if (process.env[name]?.trim()) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

function envDefined(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function redact(text: string): string {
  return text
    .replace(/access_token=[^&\s]+/gi, "access_token=REDACTED")
    .replace(/[?&]key=[^&\s]+/gi, (m) => m.replace(/key=.*/, "key=REDACTED"))
    .replace(/AIza[0-9A-Za-z_-]+/g, "[GOOGLE_KEY_REDACTED]")
    .replace(/pk\.[0-9A-Za-z._-]+/g, "[MAPBOX_TOKEN_REDACTED]")
    .replace(/sk\.[0-9A-Za-z._-]+/g, "[MAPBOX_TOKEN_REDACTED]");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function ibagueDistanceCop(distanceMeters: number): number {
  const extra = Math.max(0, distanceMeters - IBAGUE_MIN_DISTANCE_M);
  const units =
    extra <= 0 || IBAGUE_INCREMENT_M <= 0
      ? 0
      : Math.ceil(extra / IBAGUE_INCREMENT_M);
  return IBAGUE_MINIMUM_FARE + units * IBAGUE_INCREMENT_COP;
}

function pctDelta(google: number, mapbox: number): number {
  if (google === 0) {
    return mapbox === 0 ? 0 : 100;
  }
  return ((mapbox - google) / google) * 100;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function isSearchBoxUnavailable(httpStatus: number, bodyText: string): boolean {
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404) {
    return true;
  }
  const msg = bodyText.toLowerCase();
  return (
    /not authorized|forbidden|access denied/.test(msg) &&
    /search|token|api/.test(msg)
  ) || /search box/.test(msg) && /not (available|enabled|authorized)/.test(msg);
}

type FetchJsonResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  text: string;
  json: unknown;
};

async function fetchJson(
  url: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<FetchJsonResult> {
  const timeoutMs = options.timeoutMs ?? GOOGLE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { parseError: true, preview: redact(text).slice(0, 300) };
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      text,
      json,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `timeout ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      text: "",
      json: { error: redact(message) },
    };
  } finally {
    clearTimeout(timer);
  }
}

function emptySearch(
  status: ProviderStatus,
  queryUsed: string,
  error: string | null,
): SearchProviderResult {
  return {
    status,
    httpStatus: null,
    latencyMs: null,
    queryUsed,
    rawCount: 0,
    inCityCount: 0,
    rejectedOutsideCity: 0,
    candidates: [],
    botAutoAccept: null,
    botTop3: [],
    error,
  };
}

function toLabCandidates(
  ranked: PlaceCandidate[],
  city: City,
  featureTypeById: Map<string, string>,
): LabCandidate[] {
  return ranked.map((c) => ({
    name: c.name,
    address: c.address,
    location: c.location,
    placeId: c.placeId,
    featureType: featureTypeById.get(c.placeId) ?? "unknown",
    confidenceScore: c.confidenceScore,
    inBiasCity: isPointInCity(c.location, city),
    metersToBiasCenter: Math.round(haversineMeters(c.location, city.center)),
  }));
}

function finalizeSearch(
  rankedAll: PlaceCandidate[],
  city: City,
  queryUsed: string,
  httpStatus: number,
  latencyMs: number,
  featureTypeById: Map<string, string>,
): SearchProviderResult {
  const inCity = filterCandidatesInCity(rankedAll, city);
  const lab = toLabCandidates(rankedAll, city, featureTypeById);
  return {
    status: "ok",
    httpStatus,
    latencyMs,
    queryUsed,
    rawCount: rankedAll.length,
    inCityCount: inCity.length,
    rejectedOutsideCity: rankedAll.length - inCity.length,
    candidates: lab,
    botAutoAccept: inCity.length > 0 ? isHighConfidenceMatch(inCity) : false,
    botTop3: topCandidates(inCity, 3).map((c) => ({
      name: c.name,
      address: c.address,
    })),
    error: null,
  };
}

async function googleSearch(
  userQuery: string,
  city: City,
  apiKey: string | null,
): Promise<SearchProviderResult> {
  const queryUsed = buildCityScopedPlaceQuery(userQuery, city);
  if (!apiKey) {
    return emptySearch("SKIPPED_NO_GOOGLE_KEY", queryUsed, "Falta GOOGLE_MAPS_API_KEY");
  }
  const locationBias = {
    circle: {
      center: { latitude: city.center.lat, longitude: city.center.lng },
      radius: city.radiusMeters,
    },
  };
  const res = await fetchJson("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: {
      textQuery: queryUsed,
      languageCode: "es",
      regionCode: city.countryCode,
      maxResultCount: SEARCH_LIMIT,
      locationBias,
    },
  });
  if (!res.ok) {
    return {
      ...emptySearch(
        "error",
        queryUsed,
        redact(`Google Places HTTP ${res.status}`),
      ),
      httpStatus: res.status,
      latencyMs: res.latencyMs,
    };
  }
  const data = res.json as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }>;
  };
  const raw = (data.places ?? [])
    .map((place) => {
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (lat === undefined || lng === undefined) return null;
      return {
        placeId: place.id ?? "",
        name: place.displayName?.text ?? "Lugar",
        address: place.formattedAddress ?? "",
        location: { lat, lng },
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && Boolean(p.placeId));
  const ranked = rankPlaceCandidates(raw);
  const types = new Map<string, string>();
  for (const c of ranked) types.set(c.placeId, "unknown_google_fieldmask");
  return finalizeSearch(ranked, city, queryUsed, res.status, res.latencyMs, types);
}

type MapboxSearchState = {
  unavailable: boolean;
};

async function mapboxSearch(
  userQuery: string,
  city: City,
  token: string | null,
  state: MapboxSearchState,
): Promise<SearchProviderResult> {
  const queryUsed = buildCityScopedPlaceQuery(userQuery, city);
  if (!token) {
    return emptySearch("SKIPPED_NO_TOKEN", queryUsed, "Falta MAPBOX_ACCESS_TOKEN");
  }
  if (state.unavailable) {
    return emptySearch(
      "SKIPPED_SEARCHBOX_UNAVAILABLE",
      queryUsed,
      "Search Box no disponible; no se usa Geocoding",
    );
  }
  const viewport = circleToViewportRectangle(city.center, city.radiusMeters);
  const bbox = [
    viewport.low.longitude,
    viewport.low.latitude,
    viewport.high.longitude,
    viewport.high.latitude,
  ].join(",");
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/forward");
  url.searchParams.set("q", queryUsed);
  url.searchParams.set("language", "es");
  url.searchParams.set("limit", String(SEARCH_LIMIT));
  url.searchParams.set("country", "co");
  url.searchParams.set(
    "proximity",
    `${city.center.lng},${city.center.lat}`,
  );
  url.searchParams.set("bbox", bbox);
  url.searchParams.set("access_token", token);

  const res = await fetchJson(url.toString());
  if (isSearchBoxUnavailable(res.status, res.text)) {
    state.unavailable = true;
    return {
      ...emptySearch(
        "SKIPPED_SEARCHBOX_UNAVAILABLE",
        queryUsed,
        "Mapbox Search Box no disponible. No se sustituye por Geocoding.",
      ),
      httpStatus: res.status,
      latencyMs: res.latencyMs,
    };
  }
  if (!res.ok) {
    return {
      ...emptySearch(
        "error",
        queryUsed,
        redact(`Mapbox Search Box HTTP ${res.status}`),
      ),
      httpStatus: res.status,
      latencyMs: res.latencyMs,
    };
  }
  const data = res.json as {
    features?: Array<{
      properties?: {
        mapbox_id?: string;
        name?: string;
        full_address?: string;
        place_formatted?: string;
        feature_type?: string;
        address?: string;
      };
      geometry?: { coordinates?: number[] };
    }>;
    message?: string;
  };
  const raw = (data.features ?? [])
    .map((f) => {
      const coords = f.geometry?.coordinates;
      const lng = coords?.[0];
      const lat = coords?.[1];
      if (typeof lat !== "number" || typeof lng !== "number") return null;
      const id = f.properties?.mapbox_id ?? "";
      if (!id) return null;
      return {
        placeId: id,
        name: f.properties?.name ?? "Lugar",
        address:
          f.properties?.full_address ??
          f.properties?.place_formatted ??
          f.properties?.address ??
          "",
        location: { lat, lng },
        featureType: f.properties?.feature_type ?? "unknown",
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const ranked = rankPlaceCandidates(
    raw.map(({ featureType: _t, ...rest }) => rest),
  );
  const types = new Map<string, string>();
  for (const r of raw) types.set(r.placeId, r.featureType);
  return finalizeSearch(ranked, city, queryUsed, res.status, res.latencyMs, types);
}

function parseGoogleDuration(duration: string | undefined): number {
  if (!duration) return 0;
  const match = duration.match(/^([\d.]+)s$/);
  if (!match) return 0;
  return Math.round(Number(match[1]));
}

async function googleRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  apiKey: string | null,
): Promise<RouteProviderResult> {
  if (!apiKey) {
    return {
      status: "SKIPPED_NO_GOOGLE_KEY",
      profile: null,
      distanceMeters: null,
      durationSeconds: null,
      latencyMs: null,
      httpStatus: null,
      error: "Falta GOOGLE_MAPS_API_KEY",
    };
  }
  const bodyFor = (routingPreference: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE") => ({
    origin: {
      location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode: "DRIVE",
    routingPreference,
    languageCode: "es",
  });
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask":
      "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
  };
  const tryProfile = async (
    routingPreference: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE",
  ): Promise<RouteProviderResult> => {
    const res = await fetchJson(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      { method: "POST", headers, body: bodyFor(routingPreference) },
    );
    if (!res.ok) {
      return {
        status: "error",
        profile: routingPreference,
        distanceMeters: null,
        durationSeconds: null,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        error: redact(`Google Routes HTTP ${res.status}`),
      };
    }
    try {
      const mapped = parseRoutesResponse(
        res.json as {
          routes?: Array<{
            distanceMeters?: number;
            duration?: string;
            polyline?: { encodedPolyline?: string };
          }>;
        },
      );
      return {
        status: "ok",
        profile: routingPreference,
        distanceMeters: mapped.distanceMeters,
        durationSeconds:
          mapped.durationSeconds ||
          parseGoogleDuration(
            (res.json as { routes?: Array<{ duration?: string }> }).routes?.[0]
              ?.duration,
          ),
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        error: null,
      };
    } catch (error) {
      return {
        status: "error",
        profile: routingPreference,
        distanceMeters: null,
        durationSeconds: null,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        error: redact(error instanceof Error ? error.message : String(error)),
      };
    }
  };
  const aware = await tryProfile("TRAFFIC_AWARE");
  if (aware.status === "ok") return aware;
  await sleep(PAUSE_MS);
  const unaware = await tryProfile("TRAFFIC_UNAWARE");
  if (unaware.status === "ok") return unaware;
  return {
    ...aware,
    error: redact(
      `${aware.error ?? "TRAFFIC_AWARE fail"}; fallback UNAWARE: ${unaware.error ?? "fail"}`,
    ),
  };
}

type MapboxDirectionsState = {
  unavailable: boolean;
};

async function mapboxRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  token: string | null,
  state: MapboxDirectionsState,
): Promise<RouteProviderResult> {
  if (!token) {
    return {
      status: "SKIPPED_NO_TOKEN",
      profile: null,
      distanceMeters: null,
      durationSeconds: null,
      latencyMs: null,
      httpStatus: null,
      error: "Falta MAPBOX_ACCESS_TOKEN",
    };
  }
  if (state.unavailable) {
    return {
      status: "SKIPPED_DIRECTIONS_UNAVAILABLE",
      profile: null,
      distanceMeters: null,
      durationSeconds: null,
      latencyMs: null,
      httpStatus: null,
      error: "Mapbox Directions no disponible",
    };
  }
  const tryProfile = async (
    profile: "driving-traffic" | "driving",
  ): Promise<RouteProviderResult> => {
    const path = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = new URL(
      `https://api.mapbox.com/directions/v5/mapbox/${profile}/${path}`,
    );
    url.searchParams.set("geometries", "polyline");
    url.searchParams.set("overview", "false");
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("language", "es");
    url.searchParams.set("access_token", token);
    const res = await fetchJson(url.toString());
    if (res.status === 401 || res.status === 403) {
      state.unavailable = true;
      return {
        status: "SKIPPED_DIRECTIONS_UNAVAILABLE",
        profile,
        distanceMeters: null,
        durationSeconds: null,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        error: "Mapbox Directions no autorizado. No se usa Geocoding.",
      };
    }
    const data = res.json as {
      code?: string;
      message?: string;
      routes?: Array<{ distance?: number; duration?: number }>;
    };
    if (!res.ok || data.code !== "Ok" || !data.routes?.[0]) {
      return {
        status: "error",
        profile,
        distanceMeters: null,
        durationSeconds: null,
        latencyMs: res.latencyMs,
        httpStatus: res.status,
        error: redact(
          data.message ?? data.code ?? `Mapbox Directions HTTP ${res.status}`,
        ),
      };
    }
    const route = data.routes[0];
    return {
      status: "ok",
      profile: `mapbox/${profile}`,
      distanceMeters: Math.round(route.distance ?? 0),
      durationSeconds: Math.round(route.duration ?? 0),
      latencyMs: res.latencyMs,
      httpStatus: res.status,
      error: null,
    };
  };
  const traffic = await tryProfile("driving-traffic");
  if (traffic.status === "ok" || traffic.status === "SKIPPED_DIRECTIONS_UNAVAILABLE") {
    return traffic;
  }
  await sleep(PAUSE_MS);
  const driving = await tryProfile("driving");
  if (driving.status === "ok") return driving;
  return {
    ...traffic,
    error: redact(
      `${traffic.error ?? "driving-traffic fail"}; fallback driving: ${driving.error ?? "fail"}`,
    ),
  };
}

function skippedNoCoords(
  id: string,
  spec: { originLabel: string; destLabel: string; fareCity: RouteCaseResult["fareCity"] },
  coordSource: string,
): RouteCaseResult {
  const skipped: RouteProviderResult = {
    status: "SKIPPED_NO_COORDS",
    profile: null,
    distanceMeters: null,
    durationSeconds: null,
    latencyMs: null,
    httpStatus: null,
    error: "Sin coordenadas válidas (no se inventan)",
  };
  return {
    id,
    originLabel: spec.originLabel,
    destLabel: spec.destLabel,
    origin: null,
    destination: null,
    coordSource,
    fareCity: spec.fareCity,
    inPastoRadiusOrigin: null,
    inPastoRadiusDest: null,
    google: skipped,
    mapbox: skipped,
    distDeltaPct: null,
    durDeltaPct: null,
    alertDist: false,
    alertDur: false,
    ibagueGoogleCop: null,
    ibagueMapboxCop: null,
    ibagueCopDelta: null,
  };
}

function compareRoutes(
  id: string,
  origin: GeoPoint,
  destination: GeoPoint,
  originLabel: string,
  destLabel: string,
  coordSource: string,
  fareCity: RouteCaseResult["fareCity"],
  google: RouteProviderResult,
  mapbox: RouteProviderResult,
): RouteCaseResult {
  const bothOk = google.status === "ok" && mapbox.status === "ok";
  const distDeltaPct =
    bothOk && google.distanceMeters != null && mapbox.distanceMeters != null
      ? pctDelta(google.distanceMeters, mapbox.distanceMeters)
      : null;
  const durDeltaPct =
    bothOk && google.durationSeconds != null && mapbox.durationSeconds != null
      ? pctDelta(google.durationSeconds, mapbox.durationSeconds)
      : null;
  const ibagueGoogleCop =
    fareCity === "ibague" && google.distanceMeters != null
      ? ibagueDistanceCop(google.distanceMeters)
      : null;
  const ibagueMapboxCop =
    fareCity === "ibague" && mapbox.distanceMeters != null
      ? ibagueDistanceCop(mapbox.distanceMeters)
      : null;
  return {
    id,
    originLabel,
    destLabel,
    origin,
    destination,
    coordSource,
    fareCity,
    inPastoRadiusOrigin: isPointInCity(origin, PASTO),
    inPastoRadiusDest: isPointInCity(destination, PASTO),
    google,
    mapbox,
    distDeltaPct,
    durDeltaPct,
    alertDist: distDeltaPct != null && Math.abs(distDeltaPct) > DIST_ALERT_PCT,
    alertDur: durDeltaPct != null && Math.abs(durDeltaPct) > DUR_ALERT_PCT,
    ibagueGoogleCop,
    ibagueMapboxCop,
    ibagueCopDelta:
      ibagueGoogleCop != null && ibagueMapboxCop != null
        ? ibagueMapboxCop - ibagueGoogleCop
        : null,
  };
}

function pickSearchCoord(
  row: SearchCaseResult | undefined,
  inCityOnly: boolean,
): { point: GeoPoint; source: string } | null {
  if (!row) return null;
  const googleList = inCityOnly
    ? row.google.candidates.filter((c) => c.inBiasCity)
    : row.google.candidates;
  const mapboxList = inCityOnly
    ? row.mapbox.candidates.filter((c) => c.inBiasCity)
    : row.mapbox.candidates;
  if (googleList[0]) {
    return {
      point: googleList[0].location,
      source: `google_search:${row.id}`,
    };
  }
  if (mapboxList[0]) {
    return {
      point: mapboxList[0].location,
      source: `mapbox_search:${row.id}`,
    };
  }
  return null;
}

function printSearchTable(rows: SearchCaseResult[]): void {
  console.log("\n=== A. BÚSQUEDA Google Places vs Mapbox Search Box /forward ===\n");
  const header = [
    "id".padEnd(12),
    "query".padEnd(28),
    "ciudad".padEnd(8),
    "G".padEnd(22),
    "G#".padEnd(4),
    "Gin".padEnd(4),
    "M".padEnd(28),
    "M#".padEnd(4),
    "Min".padEnd(4),
    "Gtop1".padEnd(28),
    "Mtop1".padEnd(28),
    "tipoM".padEnd(16),
    "autoG",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    const g1 = row.google.botTop3[0]?.name ?? "—";
    const m1 = row.mapbox.botTop3[0]?.name ?? "—";
    const mType =
      row.mapbox.candidates.find((c) => c.inBiasCity)?.featureType ??
      row.mapbox.candidates[0]?.featureType ??
      "—";
    console.log(
      [
        row.id.padEnd(12),
        clip(row.userQuery, 28).padEnd(28),
        row.biasCity.padEnd(8),
        clip(row.google.status, 22).padEnd(22),
        String(row.google.rawCount).padEnd(4),
        String(row.google.inCityCount).padEnd(4),
        clip(row.mapbox.status, 28).padEnd(28),
        String(row.mapbox.rawCount).padEnd(4),
        String(row.mapbox.inCityCount).padEnd(4),
        clip(g1, 28).padEnd(28),
        clip(m1, 28).padEnd(28),
        clip(mType, 16).padEnd(16),
        String(row.google.botAutoAccept ?? "—"),
      ].join(" "),
    );
  }
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function printRouteTable(rows: RouteCaseResult[]): void {
  console.log("\n=== B. RUTAS Google ComputeRoutes vs Mapbox Directions ===\n");
  console.log(
    `Alertas de revisión: |Δ dist| > ${DIST_ALERT_PCT}%  |  |Δ dur| > ${DUR_ALERT_PCT}% (no son aprobación automática)\n`,
  );
  const header = [
    "id".padEnd(12),
    "origen→destino".padEnd(42),
    "G m".padEnd(8),
    "G s".padEnd(6),
    "M m".padEnd(8),
    "M s".padEnd(6),
    "Δdist".padEnd(8),
    "Δdur".padEnd(8),
    "alert".padEnd(10),
    "ΔCOP_iba".padEnd(10),
    "src",
  ].join(" ");
  console.log(header);
  console.log("-".repeat(Math.min(header.length, 160)));
  for (const row of rows) {
    const alerts = [
      row.alertDist ? "DIST" : "",
      row.alertDur ? "DUR" : "",
    ]
      .filter(Boolean)
      .join(",") || "—";
    const cop =
      row.fareCity === "pasto"
        ? "NO_FARE"
        : row.ibagueCopDelta == null
          ? "—"
          : String(row.ibagueCopDelta);
    console.log(
      [
        row.id.padEnd(12),
        clip(`${row.originLabel} → ${row.destLabel}`, 42).padEnd(42),
        String(row.google.distanceMeters ?? row.google.status).slice(0, 8).padEnd(8),
        String(row.google.durationSeconds ?? "—").slice(0, 6).padEnd(6),
        String(row.mapbox.distanceMeters ?? row.mapbox.status).slice(0, 8).padEnd(8),
        String(row.mapbox.durationSeconds ?? "—").slice(0, 6).padEnd(6),
        fmtPct(row.distDeltaPct).padEnd(8),
        fmtPct(row.durDeltaPct).padEnd(8),
        alerts.padEnd(10),
        clip(cop, 10).padEnd(10),
        clip(row.coordSource, 48),
      ].join(" "),
    );
  }
}

function printCoverage(report: LabReport): void {
  console.log("\n=== C. COBERTURA (Chachagüí / Buesaco / Tangua sin coords de repo) ===\n");
  for (const c of report.coverage) {
    console.log(
      [
        c.place.padEnd(22),
        `botCity=${c.isBotCity}`,
        `coordsRepo=${c.coordsInRepo}`,
        `G=${c.googleHits ?? "—"}`,
        `M=${c.mapboxHits ?? "—"}`,
        c.firstCoord
          ? `coord=${c.firstCoord.lat.toFixed(5)},${c.firstCoord.lng.toFixed(5)}`
          : "coord=NO_DISPONIBLE",
        c.metersToPastoCenter != null
          ? `m_pasto=${c.metersToPastoCenter}`
          : "m_pasto=—",
        `inPasto20km=${c.inPastoRadius ?? "—"}`,
        c.coordSource ?? "",
      ].join("  "),
    );
  }
}

async function main(): Promise<void> {
  loadLabEnv();
  const googleKey = envDefined("GOOGLE_MAPS_API_KEY")
    ? envValue("GOOGLE_MAPS_API_KEY")
    : null;
  const mapboxToken = envDefined("MAPBOX_ACCESS_TOKEN")
    ? envValue("MAPBOX_ACCESS_TOKEN")
    : null;

  console.log("WhatXia Bot — laboratorio geo Google vs Mapbox");
  console.log("Proveedor de producción: Google (sin cambios)");
  console.log("GEO_PROVIDER: no definido / no usado");
  console.log("GOOGLE_MAPS_API_KEY definida:", Boolean(googleKey));
  console.log("MAPBOX_ACCESS_TOKEN definida:", Boolean(mapboxToken));
  if (!mapboxToken) {
    console.log("Mapbox: SKIPPED_NO_TOKEN");
  }
  if (!googleKey) {
    console.log("Google: SKIPPED_NO_GOOGLE_KEY");
  }

  const mapboxSearchState: MapboxSearchState = { unavailable: false };
  const mapboxDirState: MapboxDirectionsState = { unavailable: false };
  const searches: SearchCaseResult[] = [];

  for (const row of SEARCH_BANK) {
    const google = await googleSearch(row.userQuery, row.biasCity, googleKey);
    await sleep(PAUSE_MS);
    const mapbox = await mapboxSearch(
      row.userQuery,
      row.biasCity,
      mapboxToken,
      mapboxSearchState,
    );
    await sleep(PAUSE_MS);
    searches.push({
      id: row.id,
      userQuery: row.userQuery,
      kind: row.kind,
      expected: row.expected,
      biasCity: row.biasCity.slug,
      google,
      mapbox,
    });
  }

  const searchById = new Map(searches.map((s) => [s.id, s]));
  const routes: RouteCaseResult[] = [];

  for (const seed of SEED_ROUTES) {
    const google = await googleRoute(seed.origin, seed.destination, googleKey);
    await sleep(PAUSE_MS);
    const mapbox = await mapboxRoute(
      seed.origin,
      seed.destination,
      mapboxToken,
      mapboxDirState,
    );
    await sleep(PAUSE_MS);
    routes.push(
      compareRoutes(
        seed.id,
        seed.origin,
        seed.destination,
        seed.originLabel,
        seed.destLabel,
        seed.coordSource,
        seed.fareCity,
        google,
        mapbox,
      ),
    );
  }

  for (const spec of DERIVED_ROUTES) {
    const originPick = spec.originSeed
      ? { point: spec.originSeed, source: "repo:seed" }
      : pickSearchCoord(
          spec.originSearchId ? searchById.get(spec.originSearchId) : undefined,
          !spec.allowOutsideCity,
        );
    const destPick = spec.destSeed
      ? { point: spec.destSeed, source: "repo:seed" }
      : pickSearchCoord(
          spec.destSearchId ? searchById.get(spec.destSearchId) : undefined,
          !spec.allowOutsideCity,
        );
    if (!originPick || !destPick) {
      routes.push(
        skippedNoCoords(spec.id, spec, "SKIPPED_NO_COORDS (sin inventar)"),
      );
      continue;
    }
    const google = await googleRoute(originPick.point, destPick.point, googleKey);
    await sleep(PAUSE_MS);
    const mapbox = await mapboxRoute(
      originPick.point,
      destPick.point,
      mapboxToken,
      mapboxDirState,
    );
    await sleep(PAUSE_MS);
    routes.push(
      compareRoutes(
        spec.id,
        originPick.point,
        destPick.point,
        spec.originLabel,
        spec.destLabel,
        `${originPick.source} | ${destPick.source}`,
        spec.fareCity,
        google,
        mapbox,
      ),
    );
  }

  const coveragePlace = (
    place: string,
    isBotCity: boolean,
    coordsInRepo: boolean,
    searchId: string | null,
    repoPoint: GeoPoint | null,
  ) => {
    const row = searchId ? searchById.get(searchId) : undefined;
    const pick = row ? pickSearchCoord(row, false) : null;
    const first = repoPoint ?? pick?.point ?? null;
    const source = repoPoint
      ? "repo"
      : pick?.source ?? (row ? "sin_coords_api" : null);
    return {
      place,
      isBotCity,
      coordsInRepo,
      googleHits: row ? row.google.rawCount : null,
      mapboxHits: row ? row.mapbox.rawCount : null,
      firstCoord: first,
      coordSource: source,
      metersToPastoCenter: first
        ? Math.round(haversineMeters(first, PASTO.center))
        : null,
      inPastoRadius: first ? isPointInCity(first, PASTO) : null,
    };
  };

  const report: LabReport = {
    ranAt: new Date().toISOString(),
    mode: "laboratorio_local",
    productionProvider: "google",
    geoProviderFlag: null,
    keys: {
      GOOGLE_MAPS_API_KEY: Boolean(googleKey),
      MAPBOX_ACCESS_TOKEN: Boolean(mapboxToken),
    },
    mapboxSearchBox: !mapboxToken
      ? "SKIPPED_NO_TOKEN"
      : mapboxSearchState.unavailable
        ? "SKIPPED_SEARCHBOX_UNAVAILABLE"
        : searches.some((s) => s.mapbox.status === "ok")
          ? "ok"
          : "unknown",
    searches,
    routes,
    coverage: [
      coveragePlace("Ibagué", true, true, "IB-POI-05", SEED.ibagueCenter),
      coveragePlace("Pasto", true, true, "PA-POI-01", SEED.pastoCenter),
      coveragePlace("Chachagüí", false, false, "NR-CHA-01", null),
      coveragePlace("Buesaco", false, false, "NR-BUE-01", null),
      coveragePlace("Tangua", false, false, "NR-TAN-01", null),
    ],
  };

  printSearchTable(searches);
  printRouteTable(routes);
  printCoverage(report);

  console.log("\n=== JSON ===\n");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
