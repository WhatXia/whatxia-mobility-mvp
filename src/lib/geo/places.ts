import {
  fetchGoogleJsonWithRetry,
  GoogleMapsError,
} from "@/lib/geo/client";
import {
  getCityBias,
  getCityRadiusMeters,
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
 */
export async function searchPlaces(
  query: string,
  bias?: GeoPoint,
): Promise<PlaceCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
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

  let data: PlacesSearchTextResponse;
  try {
    data = await fetchGoogleJsonWithRetry<PlacesSearchTextResponse>(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location",
        },
        body,
        includeKeyInQuery: false,
      },
    );
  } catch (error) {
    if (error instanceof GoogleMapsError) {
      throw error;
    }
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

  return rankPlaceCandidates(raw);
}
