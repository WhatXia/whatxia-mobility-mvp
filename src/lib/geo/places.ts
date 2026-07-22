import {
  fetchGoogleJsonWithRetry,
  GoogleMapsError,
} from "@/lib/geo/client";
import {
  getGoogleMapsApiKey,
  logGoogleMapsApiKeyRuntimeProbe,
} from "@/lib/geo/config";
import { rankPlaceCandidates } from "@/lib/geo/confidence";
import type { PlaceCandidate } from "@/lib/geo/types";
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
};

export type SearchPlacesResult = {
  city: City;
  queryUsed: string;
  candidates: PlaceCandidate[];
  /** Candidatos que Google devolvió pero quedaron fuera del radio. */
  rejectedOutsideCity: number;
};

/**
 * Busca lugares con Places API (New), restringido a la ciudad activa.
 * Usa locationRestriction (círculo duro) + query con ciudad/región.
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

  // locationRestriction = solo resultados dentro del área (no solo bias).
  const body = {
    textQuery,
    languageCode: "es",
    regionCode: city.countryCode,
    maxResultCount: 8,
    locationRestriction: {
      circle: {
        center: {
          latitude: city.center.lat,
          longitude: city.center.lng,
        },
        radius: city.radiusMeters,
      },
    },
  };

  console.log("[places:diag] REQUEST", {
    apiProduct,
    endpoint,
    method: "POST",
    userQuery: trimmed,
    textQuery,
    city: city.slug,
    keyLoaded,
    keyMasked,
    locationRestriction: body.locationRestriction,
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
      city: city.slug,
      keyLoaded,
      keyMasked,
      status: error instanceof GoogleMapsError ? error.status : undefined,
      googleBody:
        error instanceof GoogleMapsError ? error.bodySnippet : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

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
    httpStatus: 200,
    rawCount: ranked.length,
    inCityCount: inCity.length,
    rejectedOutsideCity,
    top: inCity.slice(0, 3).map((c) => c.name),
  });

  return {
    city,
    queryUsed: textQuery,
    candidates: inCity,
    rejectedOutsideCity,
  };
}
