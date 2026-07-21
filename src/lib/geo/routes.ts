import { fetchGoogleJsonWithRetry, GoogleMapsError } from "@/lib/geo/client";
import type { GeoPoint, RouteEstimate } from "@/lib/geo/types";

type ComputeRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }>;
  error?: { message?: string; status?: string };
};

function parseDurationSeconds(duration: string | undefined): number {
  if (!duration) {
    return 0;
  }
  // Routes API: "123s" or "123.5s"
  const match = duration.match(/^([\d.]+)s$/);
  if (!match) {
    return 0;
  }
  return Math.round(Number(match[1]));
}

function mapRoute(data: ComputeRoutesResponse): RouteEstimate {
  const route = data.routes?.[0];
  if (!route || route.distanceMeters === undefined) {
    throw new GoogleMapsError("Routes API no devolvió una ruta válida");
  }

  return {
    distanceMeters: route.distanceMeters,
    durationSeconds: parseDurationSeconds(route.duration),
    polylineEncoded: route.polyline?.encodedPolyline,
  };
}

async function computeRoutes(
  origin: GeoPoint,
  destination: GeoPoint,
  routingPreference: "TRAFFIC_AWARE" | "TRAFFIC_UNAWARE",
): Promise<RouteEstimate> {
  const body = {
    origin: {
      location: {
        latLng: { latitude: origin.lat, longitude: origin.lng },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      },
    },
    travelMode: "DRIVE",
    routingPreference,
    languageCode: "es",
  };

  const data = await fetchGoogleJsonWithRetry<ComputeRoutesResponse>(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
      },
      body,
      includeKeyInQuery: false,
    },
  );

  return mapRoute(data);
}

/**
 * Estima ruta en auto. Intenta TRAFFIC_AWARE y cae a TRAFFIC_UNAWARE.
 */
export async function estimateRoute(
  origin: GeoPoint,
  destination: GeoPoint,
): Promise<RouteEstimate> {
  try {
    return await computeRoutes(origin, destination, "TRAFFIC_AWARE");
  } catch (error) {
    console.warn("[geo:routes] TRAFFIC_AWARE falló, reintento UNAWARE", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return computeRoutes(origin, destination, "TRAFFIC_UNAWARE");
  }
}

/** Parseo puro para certificación con fixtures. */
export function parseRoutesResponse(
  data: ComputeRoutesResponse,
): RouteEstimate {
  return mapRoute(data);
}
