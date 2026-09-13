import type { GeoPoint } from "@/lib/geo/types";
import { MAPBOX_PLACE_ID_PREFIX } from "@/lib/geo/config";

function stripPlacesPrefix(placeId: string): string {
  return placeId.startsWith("places/")
    ? placeId.slice("places/".length)
    : placeId;
}

/**
 * Solo Place IDs de Google pueden ir a Maps URLs.
 * Prefijo mapbox: y mapbox_id (dXJu…) nunca se envían como destination_place_id.
 */
export function googlePlaceIdForMapsUrl(
  placeId: string | null | undefined,
): string | null {
  if (!placeId?.trim()) {
    return null;
  }
  const id = stripPlacesPrefix(placeId.trim());
  if (id.startsWith(MAPBOX_PLACE_ID_PREFIX)) {
    return null;
  }
  if (id.startsWith("dXJu")) {
    return null;
  }
  return id;
}

/** Deep link de Google Maps centrado en un punto. */
export function mapsUrlForPoint(point: GeoPoint, label?: string): string {
  const q = label
    ? encodeURIComponent(label)
    : `${point.lat},${point.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=`;
}

export function mapsUrlForCoords(point: GeoPoint): string {
  return `https://www.google.com/maps?q=${point.lat},${point.lng}`;
}

export function mapsUrlForPlaceId(placeId: string, name?: string): string {
  const id = googlePlaceIdForMapsUrl(placeId);
  if (!id) {
    const query = encodeURIComponent(name?.trim() || "destino");
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
  }
  const query = encodeURIComponent(name ?? id);
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(id)}`;
}

/** Navegación turn-by-turn hacia el destino (coords y/o place_id Google). */
export function mapsNavigationUrl(input: {
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  label?: string | null;
}): string | null {
  const label = input.label?.trim();
  const placeId = googlePlaceIdForMapsUrl(input.placeId);

  if (input.lat != null && input.lng != null) {
    const dest = `${input.lat},${input.lng}`;
    const params = new URLSearchParams({
      api: "1",
      destination: dest,
    });
    if (placeId) {
      params.set("destination_place_id", placeId);
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  if (placeId) {
    return mapsUrlForPlaceId(placeId, label ?? undefined);
  }

  if (label) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(label)}`;
  }

  return null;
}
