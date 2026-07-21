import type { GeoPoint } from "@/lib/geo/types";

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
  const id = placeId.startsWith("places/")
    ? placeId.slice("places/".length)
    : placeId;
  const query = encodeURIComponent(name ?? id);
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(id)}`;
}
