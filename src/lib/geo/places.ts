import {
  fetchGoogleJsonWithRetry,
  GoogleMapsError,
} from "@/lib/geo/client";
import {
  getCityBias,
  getCityRadiusMeters,
  getGoogleMapsApiKey,
  logGoogleMapsApiKeyRuntimeProbe,
} from "@/lib/geo/config";
import { rankPlaceCandidates } from "@/lib/geo/confidence";
import type { GeoPoint, PlaceCandidate } from "@/lib/geo/types";

type PlacesSearchTextResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
};

/**
 * Busca lugares con Places API (New) Text Search.
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText
 */
export async function searchPlaces(
  query: string,
  bias?: GeoPoint,
): Promise<PlaceCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const endpoint = "https://places.googleapis.com/v1/places:searchText";
  const apiProduct = "Places API (New) — places:searchText";

  // TEMP: verificar valor exacto leído en runtime (nunca la key completa).
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

  const center = bias ?? getCityBias();
  const radius = getCityRadiusMeters();

  const body = {
    textQuery: trimmed,
    languageCode: "es",
    maxResultCount: 5,
    locationBias: {
      circle: {
        center: {
          latitude: center.lat,
          longitude: center.lng,
        },
        radius,
      },
    },
  };

  console.log("[places:diag] REQUEST", {
    apiProduct,
    endpoint,
    method: "POST",
    textQuery: trimmed,
    keyLoaded,
    keyMasked,
    authHeader: "X-Goog-Api-Key",
    fieldMask:
      "places.id,places.displayName,places.formattedAddress,places.location",
    locationBias: body.locationBias,
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
      textQuery: trimmed,
      keyLoaded,
      keyMasked,
      status: error instanceof GoogleMapsError ? error.status : undefined,
      googleBody:
        error instanceof GoogleMapsError ? error.bodySnippet : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.log("[places:diag] OK", {
    apiProduct,
    endpoint,
    textQuery: trimmed,
    httpStatus: 200,
    resultCount: data.places?.length ?? 0,
    responsePreview: JSON.stringify(data).slice(0, 2000),
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

  return rankPlaceCandidates(raw);
}
