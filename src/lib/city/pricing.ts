/**
 * Modo tarifario por ciudad.
 *
 * FARE: estimateFare en booking + finalizeFare al completar.
 * NO_FARE: publica y completa sin motor tarifario ni fila en fare_rules.
 *
 * El Tariff Engine no conoce este modo: Mobility decide si invocarlo.
 * Añadir una ciudad sin tarifa = incluir su slug aquí; no ramificar en finalizeFare().
 */

import { PASTO_CORRIDOR_SLUGS } from "@/lib/city/corridors";

export type CityPricingMode = "FARE" | "NO_FARE";

/** Ciudad operacional que hoy opera sin tarifa. */
export const PASTO_CITY_SLUG = "pasto";

/**
 * Corredor Pasto: mismos slugs geográficos, mismo NO_FARE.
 * Sin esto, un pickup en Tangua/etc. intentaría FARE y el cierre fallaría
 * (no hay fare_rules; no se inventan tarifas).
 */
const NO_FARE_CITY_SLUGS = new Set<string>(PASTO_CORRIDOR_SLUGS);

export function pricingModeForCitySlug(citySlug: string): CityPricingMode {
  const slug = citySlug.trim().toLowerCase();
  return NO_FARE_CITY_SLUGS.has(slug) ? "NO_FARE" : "FARE";
}

export function cityUsesFare(citySlug: string): boolean {
  return pricingModeForCitySlug(citySlug) === "FARE";
}

/** true → hay que llamar finalizeFare antes de marcar COMPLETED. */
export function shouldFinalizeFare(citySlug: string): boolean {
  return cityUsesFare(citySlug);
}

export type TripCompletionPlan = {
  pricingMode: CityPricingMode;
  runFinalizeFare: boolean;
  persistFinalFare: boolean;
};

export function planTripCompletion(citySlug: string): TripCompletionPlan {
  const pricingMode = pricingModeForCitySlug(citySlug);
  const usesFare = pricingMode === "FARE";
  return {
    pricingMode,
    runFinalizeFare: usesFare,
    persistFinalFare: usesFare,
  };
}
