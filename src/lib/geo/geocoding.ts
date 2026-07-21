import { fetchGoogleJsonWithRetry, GoogleMapsError } from "@/lib/geo/client";
import type { GeoPoint, ResolvedPlace } from "@/lib/geo/types";

type GeocodeResponse = {
  status: string;
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: Array<{
      long_name?: string;
      types?: string[];
    }>;
  }>;
  error_message?: string;
};

/**
 * Reverse geocode de una ubicación compartida por el usuario.
 */
export async function reverseGeocode(
  point: GeoPoint,
): Promise<ResolvedPlace> {
  const data = await fetchGoogleJsonWithRetry<GeocodeResponse>(
    "https://maps.googleapis.com/maps/api/geocode/json",
    {
      method: "GET",
      searchParams: {
        latlng: `${point.lat},${point.lng}`,
        language: "es",
      },
      includeKeyInQuery: true,
    },
  );

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new GoogleMapsError(
      `Geocoding failed: ${data.status} ${data.error_message ?? ""}`.trim(),
    );
  }

  const first = data.results?.[0];
  if (!first) {
    return {
      placeId: null,
      name: "Ubicación compartida",
      address: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
      location: point,
    };
  }

  const neighborhood = first.address_components?.find((c) =>
    c.types?.includes("neighborhood") ||
    c.types?.includes("sublocality") ||
    c.types?.includes("route"),
  )?.long_name;

  return {
    placeId: first.place_id ?? null,
    name: neighborhood ?? first.formatted_address ?? "Ubicación",
    address: first.formatted_address ?? "",
    location: {
      lat: first.geometry?.location?.lat ?? point.lat,
      lng: first.geometry?.location?.lng ?? point.lng,
    },
  };
}

export function candidateToResolved(
  candidate: {
    placeId: string;
    name: string;
    address: string;
    location: GeoPoint;
  },
): ResolvedPlace {
  return {
    placeId: candidate.placeId,
    name: candidate.name,
    address: candidate.address,
    location: candidate.location,
  };
}
