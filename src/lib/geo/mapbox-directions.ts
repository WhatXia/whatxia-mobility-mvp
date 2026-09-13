import { getMapboxAccessToken } from "@/lib/geo/config";
import {
  fetchMapboxJson,
  MapboxApiError,
} from "@/lib/geo/mapbox-client";
import { toMapboxLngLat } from "@/lib/geo/mapbox-search";
import type { GeoPoint, RouteEstimate } from "@/lib/geo/types";

export const MAPBOX_DIRECTIONS_BASE =
  "https://api.mapbox.com/directions/v5/mapbox";

type MapboxDirectionsResponse = {
  code?: string;
  message?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: string;
  }>;
};

export function buildMapboxDirectionsUrl(
  origin: GeoPoint,
  destination: GeoPoint,
  profile: "driving-traffic" | "driving",
  token: string,
): string {
  const coords = `${toMapboxLngLat(origin)};${toMapboxLngLat(destination)}`;
  const url = new URL(`${MAPBOX_DIRECTIONS_BASE}/${profile}/${coords}`);
  url.searchParams.set("geometries", "polyline");
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("language", "es");
  url.searchParams.set("access_token", token);
  return url.toString();
}

export function parseMapboxDirectionsResponse(
  data: MapboxDirectionsResponse,
): RouteEstimate {
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route || route.distance === undefined) {
    throw new MapboxApiError("Mapbox Directions no devolvió una ruta válida");
  }
  return {
    distanceMeters: Math.round(route.distance),
    durationSeconds: Math.round(route.duration ?? 0),
    polylineEncoded:
      typeof route.geometry === "string" ? route.geometry : undefined,
  };
}

async function computeMapboxRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  profile: "driving-traffic" | "driving",
  token: string,
): Promise<RouteEstimate> {
  const url = buildMapboxDirectionsUrl(origin, destination, profile, token);
  const data = await fetchMapboxJson<MapboxDirectionsResponse>(url);
  return parseMapboxDirectionsResponse(data);
}

export async function estimateRouteWithMapbox(
  origin: GeoPoint,
  destination: GeoPoint,
): Promise<RouteEstimate> {
  const token = getMapboxAccessToken();
  if (!token) {
    throw new MapboxApiError("MAPBOX_ACCESS_TOKEN ausente", 401);
  }
  try {
    return await computeMapboxRoute(
      origin,
      destination,
      "driving-traffic",
      token,
    );
  } catch (error) {
    const status = error instanceof MapboxApiError ? error.status : undefined;
    if (status === 401 || status === 403) {
      throw error;
    }
    console.warn("[geo:mapbox] driving-traffic falló, reintento driving", {
      reason: error instanceof Error ? error.message : "error",
    });
    return computeMapboxRoute(origin, destination, "driving", token);
  }
}
