/**
 * Tariff Engine v1 — API pública para Mobility y futuros canales.
 *
 * Mobility solicita tarifas; nunca implementa fórmulas.
 * Configuración: única fuente = Supabase public.fare_rules
 * (sin fallback a city-config/*.ts). Nueva ciudad = solo DB.
 */

import { formatTariffCop } from "@/lib/tariff/calculator";
import { loadCityTariffConfig } from "@/lib/tariff/config-loader";
import {
  getTariffProvider,
  setTariffProvider,
  resetTariffProvider,
} from "@/lib/tariff/provider";
import type {
  CityTariffConfig,
  EstimateFareInput,
  FinalizeFareInput,
  TariffProvider,
  TariffQuote,
} from "@/lib/tariff/types";

export { formatTariffCop };
export type {
  CityTariffConfig,
  EstimateFareInput,
  FinalizeFareInput,
  TariffQuote,
  TariffProvider,
};

/** Resuelve config tarifaria desde Supabase (SSoT). */
export async function resolveCityTariff(
  citySlug: string,
): Promise<CityTariffConfig> {
  return loadCityTariffConfig(citySlug);
}

/**
 * Tarifa estimada (informativa) antes de aceptar el servicio.
 */
export async function estimateFare(
  input: EstimateFareInput,
): Promise<TariffQuote> {
  const config = await resolveCityTariff(input.citySlug);
  const quote = await getTariffProvider().estimate(input, config);

  console.log("[tariff:estimate]", {
    city: config.citySlug,
    amount: quote.amount,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    provider: quote.provider,
    breakdown: quote.breakdown,
  });

  return quote;
}

/**
 * Tarifa final (única oficial) al terminar el viaje.
 */
export async function finalizeFare(
  input: FinalizeFareInput,
): Promise<TariffQuote> {
  const config = await resolveCityTariff(input.citySlug);
  const quote = await getTariffProvider().finalize(input, config);

  console.log("[tariff:final]", {
    city: config.citySlug,
    amount: quote.amount,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    waitSeconds: quote.breakdown.waitSecondsUsed,
    waitSource: quote.breakdown.waitSource,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    provider: quote.provider,
    breakdown: quote.breakdown,
  });

  return quote;
}

export { setTariffProvider, resetTariffProvider };
