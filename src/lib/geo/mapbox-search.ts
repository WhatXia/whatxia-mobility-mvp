import {
  buildCityScopedPlaceQuery,
  filterCandidatesInCity,
  type City,
} from "@/lib/city/context";
import { rankPlaceCandidates } from "@/lib/geo/confidence";
import {
  getMapboxAccessToken,
  MAPBOX_PLACE_ID_PREFIX,
} from "@/lib/geo/config";
import {
  fetchMapboxJson,
  MapboxApiError,
} from "@/lib/geo/mapbox-client";
import type { GeoPoint, PlaceCandidate } from "@/lib/geo/types";

export const MAPBOX_SEARCHBOX_FORWARD_PATH =
  "https://api.mapbox.com/search/searchbox/v1/forward";
export const MAPBOX_GEOCODING_PATHS = [
  "https://api.mapbox.com/geocoding/",
  "https://api.mapbox.com/search/geocode/",
] as const;

type SearchBoxForwardResponse = {
  features?: Array<{
    properties?: {
      mapbox_id?: string;
      name?: string;
      full_address?: string;
      place_formatted?: string;
      address?: string;
    };
    geometry?: { coordinates?: number[] };
  }>;
  message?: string;
};

export function toMapboxLngLat(point: GeoPoint): string {
  return `${point.lng},${point.lat}`;
}

function circleToViewportRectangle(
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

export function buildMapboxSearchBoxForwardUrl(
  query: string,
  city: City,
  token: string,
): string {
  const viewport = circleToViewportRectangle(city.center, city.radiusMeters);
  const bbox = [
    viewport.low.longitude,
    viewport.low.latitude,
    viewport.high.longitude,
    viewport.high.latitude,
  ].join(",");
  const url = new URL(MAPBOX_SEARCHBOX_FORWARD_PATH);
  url.searchParams.set("q", query);
  url.searchParams.set("language", "es");
  url.searchParams.set("limit", "8");
  url.searchParams.set("country", city.countryCode.toLowerCase());
  url.searchParams.set("proximity", toMapboxLngLat(city.center));
  url.searchParams.set("bbox", bbox);
  url.searchParams.set("access_token", token);
  return url.toString();
}

export function mapSearchBoxFeaturesToCandidates(
  data: SearchBoxForwardResponse,
): PlaceCandidate[] {
  const raw = (data.features ?? [])
    .map((feature) => {
      const lng = feature.geometry?.coordinates?.[0];
      const lat = feature.geometry?.coordinates?.[1];
      const mapboxId = feature.properties?.mapbox_id?.trim();
      if (typeof lat !== "number" || typeof lng !== "number" || !mapboxId) {
        return null;
      }
      return {
        placeId: `${MAPBOX_PLACE_ID_PREFIX}${mapboxId}`,
        name: feature.properties?.name ?? "Lugar",
        address:
          feature.properties?.full_address ??
          feature.properties?.place_formatted ??
          feature.properties?.address ??
          "",
        location: { lat, lng },
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return rankPlaceCandidates(raw);
}

function isSearchBoxUnavailable(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404;
}

/**
 * Search Box /forward. No usa Geocoding.
 * placeId interno lleva prefijo mapbox: para que mapsNavigationUrl lo ignore.
 */
export async function searchPlacesWithMapbox(
  query: string,
  city: City,
): Promise<{
  city: City;
  queryUsed: string;
  candidates: PlaceCandidate[];
  rejectedOutsideCity: number;
}> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      city,
      queryUsed: "",
      candidates: [],
      rejectedOutsideCity: 0,
    };
  }

  const token = getMapboxAccessToken();
  if (!token) {
    throw new MapboxApiError("MAPBOX_ACCESS_TOKEN ausente", 401);
  }

  const textQuery = buildCityScopedPlaceQuery(trimmed, city);
  const url = buildMapboxSearchBoxForwardUrl(textQuery, city, token);

  let data: SearchBoxForwardResponse;
  try {
    data = await fetchMapboxJson<SearchBoxForwardResponse>(url);
  } catch (error) {
    if (error instanceof MapboxApiError && isSearchBoxUnavailable(error.status)) {
      throw new MapboxApiError(
        "Mapbox Search Box no disponible; no se usa Geocoding",
        error.status,
        "SEARCHBOX_UNAVAILABLE",
      );
    }
    throw error;
  }

  const ranked = mapSearchBoxFeaturesToCandidates(data);
  const inCity = filterCandidatesInCity(ranked, city);
  return {
    city,
    queryUsed: textQuery,
    candidates: inCity,
    rejectedOutsideCity: ranked.length - inCity.length,
  };
}
