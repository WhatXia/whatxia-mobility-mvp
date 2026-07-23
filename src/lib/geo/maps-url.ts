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

/** Navegación turn-by-turn hacia el destino (coords y/o place_id). */
export function mapsNavigationUrl(input: {
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
  label?: string | null;
}): string | null {
  const label = input.label?.trim();
  const placeId = input.placeId
    ? input.placeId.startsWith("places/")
      ? input.placeId.slice("places/".length)
      : input.placeId
    : null;

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
