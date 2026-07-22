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

/**
 * Inferencia de origen de env (Next no expone el path del archivo).
 * Local: Next carga .env.local automáticamente.
 * Vercel: variables del dashboard (no usa .env.local del repo).
 */
export function resolveGoogleMapsKeyEnvSource(): {
  source: string;
  nodeEnv: string | undefined;
  vercel: boolean;
  vercelEnv: string | undefined;
} {
  const onVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);

  if (onVercel) {
    return {
      source: `Vercel Project Settings (Environment Variables) — VERCEL_ENV=${process.env.VERCEL_ENV ?? "?"}`,
      nodeEnv: process.env.NODE_ENV,
      vercel: true,
      vercelEnv: process.env.VERCEL_ENV,
    };
  }

  if (process.env.NODE_ENV === "development") {
    return {
      source:
        "Local Next.js — típico: .env.local (prioridad sobre .env). No es Vercel.",
      nodeEnv: process.env.NODE_ENV,
      vercel: false,
      vercelEnv: undefined,
    };
  }

  return {
    source:
      "Runtime no-Vercel (NODE_ENV≠development) — revisar shell/CI/.env* del proceso",
    nodeEnv: process.env.NODE_ENV,
    vercel: false,
    vercelEnv: undefined,
  };
}

/** Log temporal: solo primeros/últimos 6 chars. Nunca la clave completa. */
export function logGoogleMapsApiKeyRuntimeProbe(context: string): void {
  const raw = process.env.GOOGLE_MAPS_API_KEY;
  const key = raw?.trim() ?? "";
  const envSource = resolveGoogleMapsKeyEnvSource();

  console.log("[TEMP:GOOGLE_MAPS_API_KEY_PROBE]", {
    context,
    defined: raw !== undefined,
    emptyAfterTrim: key.length === 0,
    length: key.length,
    hadLeadingOrTrailingWhitespace: Boolean(raw && raw !== raw.trim()),
    // Pedido explícito: primeros 6 + últimos 6
    prefix6: key.length >= 6 ? key.slice(0, 6) : key,
    suffix6: key.length >= 6 ? key.slice(-6) : key,
    masked: key.length >= 12 ? `${key.slice(0, 6)}…${key.slice(-6)}` : "(corta)",
    envSource: envSource.source,
    NODE_ENV: envSource.nodeEnv,
    VERCEL: process.env.VERCEL ?? null,
    VERCEL_ENV: envSource.vercelEnv ?? null,
  });
}

/** Centro de bias legacy — preferir getActiveCity() (Sprint 26). */
export function getCityBias(): GeoPoint {
  return {
    lat: envNumber("GEO_CITY_LAT", 4.4389),
    lng: envNumber("GEO_CITY_LNG", -75.2322),
  };
}

export function getCityRadiusMeters(): number {
  return envNumber("GEO_CITY_RADIUS_M", 18000);
}

export function getPlaceConfidenceThreshold(): number {
  return envNumber("PLACE_CONFIDENCE_THRESHOLD", 0.75);
}

/** Margen mínimo entre 1º y 2º candidato para aceptar alta confianza. */
export const PLACE_TOP_MARGIN = 0.2;

export const GOOGLE_FETCH_TIMEOUT_MS = 8000;
