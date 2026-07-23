import type { CityTariffConfig } from "@/lib/tariff/types";

/**
 * Estima segundos de espera a partir de la velocidad media del recorrido.
 *
 * Si la velocidad media está por debajo del umbral de la ciudad, una fracción
 * del tiempo total se considera espera. Sin traza GPS punto-a-punto es una
 * heurística; taxímetros electrónicos pueden enviar `waitSeconds` real.
 */
export function deriveWaitSecondsFromSpeed(params: {
  distanceMeters: number;
  durationSeconds: number;
  waitSpeedThresholdKmh: number;
}): number {
  const { distanceMeters, durationSeconds, waitSpeedThresholdKmh } = params;

  if (durationSeconds <= 0 || waitSpeedThresholdKmh <= 0) {
    return 0;
  }

  const hours = durationSeconds / 3600;
  if (hours <= 0) {
    return 0;
  }

  const avgKmh = distanceMeters / 1000 / hours;
  if (avgKmh >= waitSpeedThresholdKmh) {
    return 0;
  }

  const factor = 1 - avgKmh / waitSpeedThresholdKmh;
  return Math.floor(durationSeconds * Math.max(0, Math.min(1, factor)));
}

export function resolveWaitSeconds(params: {
  config: CityTariffConfig;
  distanceMeters: number;
  durationSeconds: number;
  providedWaitSeconds?: number;
  deriveFromSpeed: boolean;
}): { waitSeconds: number; source: "provided" | "speed_heuristic" | "none" } {
  if (
    params.providedWaitSeconds !== undefined &&
    params.providedWaitSeconds !== null
  ) {
    return {
      waitSeconds: Math.max(0, params.providedWaitSeconds),
      source: "provided",
    };
  }

  if (!params.deriveFromSpeed) {
    return { waitSeconds: 0, source: "none" };
  }

  const waitSeconds = deriveWaitSecondsFromSpeed({
    distanceMeters: params.distanceMeters,
    durationSeconds: params.durationSeconds,
    waitSpeedThresholdKmh: params.config.waitSpeedThresholdKmh,
  });

  return {
    waitSeconds,
    source: waitSeconds > 0 ? "speed_heuristic" : "none",
  };
}
