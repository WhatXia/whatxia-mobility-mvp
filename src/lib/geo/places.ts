import {
  fetchGoogleJsonWithRetry,
  GoogleMapsError,
} from "@/lib/geo/client";
import {
  getGoogleMapsApiKey,
  logGoogleMapsApiKeyRuntimeProbe,
} from "@/lib/geo/config";
import { rankPlaceCandidates } from "@/lib/geo/confidence";
import type { GeoPoint, PlaceCandidate } from "@/lib/geo/types";
import {
  buildCityScopedPlaceQuery,
  filterCandidatesInCity,
  getActiveCity,
  type City,
} from "@/lib/city/context";

type PlacesSearchTextResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
  error?: unknown;
};

export type SearchPlacesResult = {
  city: City;
  queryUsed: string;
  candidates: PlaceCandidate[];
  /** Candidatos que Google devolvió pero quedaron fuera del radio. */
  rejectedOutsideCity: number;
};

/**
 * Sprint 28 diagnóstico:
 * Places API (New) Text Search — `locationRestriction` SOLO admite rectangle.
 * `locationRestriction.circle` es inválido (Unknown name "circle") y provoca
 * fallos / cero resultados. Por eso usamos `locationBias.circle` (válido)
 * + query enriquecida "…, Ibagué, Tolima" + filtro local isPointInCity.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */
function buildLocationBiasCircle(city: City) {
  return {
    circle: {
      center: {
        latitude: city.center.lat,
        longitude: city.center.lng,
      },
      // Metros (0–50000). 18000 = 18 km.
      radius: city.radiusMeters,
    },
  };
}

/** Viewport rectangular aproximado al radio (por si se reactiva restriction). */
export function circleToViewportRectangle(
  center: GeoPoint,
  radiusMeters: number,
): {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
} {
  const metersPerDegLat = 111_320;
  const metersPerDegLng =
    111_320 * Math.cos((center.lat * Math.PI) / 180) || 111_320;
  const dLat = radiusMeters / metersPerDegLat;
  const dLng = radiusMeters / metersPerDegLng;
  return {
    low: {
      latitude: center.lat - dLat,
      longitude: center.lng - dLng,
    },
    high: {
      latitude: center.lat + dLat,
      longitude: center.lng + dLng,
    },
  };
}

/**
 * Busca lugares con Places API (New), sesgados a la ciudad activa.
 */
export async function searchPlaces(
  query: string,
): Promise<SearchPlacesResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    const city = await getActiveCity();
    return {
      city,
      queryUsed: "",
      candidates: [],
      rejectedOutsideCity: 0,
    };
  }

  const city = await getActiveCity();
  const textQuery = buildCityScopedPlaceQuery(trimmed, city);
  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const apiProduct = "Places API (New) — places:searchText";
  const locationBias = buildLocationBiasCircle(city);

  logGoogleMapsApiKeyRuntimeProbe("searchPlaces:before_fetch");

  let keyLoaded = false;
  let keyMasked: string | null = null;
  try {
    const key = getGoogleMapsApiKey();
    keyLoaded = Boolean(key);
    keyMasked =
      key.length >= 12
        ? `${key.slice(0, 6)}…${key.slice(-6)} (len=${key.length})`
        : `(len=${key.length})`;
  } catch {
    keyLoaded = false;
    keyMasked = null;
  }

  const body = {
    textQuery,
    languageCode: "es",
    regionCode: city.countryCode,
    maxResultCount: 8,
    locationBias,
  };

  console.log("[places:diag] REQUEST", {
    apiProduct,
    endpoint,
    method: "POST",
    userQuery: trimmed,
    textQuery,
    city: {
      slug: city.slug,
      name: city.name,
      center: city.center,
      radiusMeters: city.radiusMeters,
      radiusNote: "metros (18000 = 18 km)",
    },
    locationMode: "locationBias.circle (NO locationRestriction.circle)",
    locationBias,
    keyLoaded,
    keyMasked,
  });

  let data: PlacesSearchTextResponse;
  try {
    data = await fetchGoogleJsonWithRetry<PlacesSearchTextResponse>(endpoint, {
      method: "POST",
      headers: {
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body,
      includeKeyInQuery: false,
    });
  } catch (error) {
    console.error("[places:diag] FAIL", {
      apiProduct,
      endpoint,
      textQuery,
      cityCenter: city.center,
      radiusMeters: city.radiusMeters,
      keyLoaded,
      keyMasked,
      status: error instanceof GoogleMapsError ? error.status : undefined,
      googleBodyFull:
        error instanceof GoogleMapsError ? error.bodySnippet : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // Respuesta completa (sin API key).
  console.log("[places:diag] GOOGLE_RESPONSE_FULL", {
    textQuery,
    cityCenter: city.center,
    radiusMeters: city.radiusMeters,
    response: data,
  });

  const raw = (data.places ?? [])
    .map((place) => {
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (lat === undefined || lng === undefined) {
        return null;
      }
      return {
        placeId: place.id ?? "",
        name: place.displayName?.text ?? "Lugar",
        address: place.formattedAddress ?? "",
        location: { lat, lng },
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && Boolean(p.placeId));

  const ranked = rankPlaceCandidates(raw);
  const inCity = filterCandidatesInCity(ranked, city);
  const rejectedOutsideCity = ranked.length - inCity.length;

  console.log("[places:diag] OK", {
    apiProduct,
    city: city.slug,
    textQuery,
    cityCenter: city.center,
    radiusMeters: city.radiusMeters,
    httpStatus: 200,
    rawCount: ranked.length,
    inCityCount: inCity.length,
    rejectedOutsideCity,
    top: inCity.slice(0, 5).map((c) => ({
      name: c.name,
      address: c.address,
      location: c.location,
    })),
  });

  return {
    city,
    queryUsed: textQuery,
    candidates: inCity,
    rejectedOutsideCity,
  };
}
