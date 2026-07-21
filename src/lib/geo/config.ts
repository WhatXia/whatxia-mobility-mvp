import type { GeoPoint } from "@/lib/geo/types";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getGoogleMapsApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    throw new Error("Falta GOOGLE_MAPS_API_KEY en el entorno.");
  }
  return key;
}

/** Centro de bias para Places (default: Cali, CO). */
export function getCityBias(): GeoPoint {
  return {
    lat: envNumber("GEO_CITY_LAT", 3.4516),
    lng: envNumber("GEO_CITY_LNG", -76.532),
  };
}

export function getCityRadiusMeters(): number {
  return envNumber("GEO_CITY_RADIUS_M", 25000);
}

export function getPlaceConfidenceThreshold(): number {
  return envNumber("PLACE_CONFIDENCE_THRESHOLD", 0.75);
}

/** Margen mínimo entre 1º y 2º candidato para aceptar alta confianza. */
export const PLACE_TOP_MARGIN = 0.2;

export const GOOGLE_FETCH_TIMEOUT_MS = 8000;
