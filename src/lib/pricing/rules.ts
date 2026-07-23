/**
 * @deprecated Preferir `@/lib/tariff/config-loader` (SSoT = fare_rules).
 * Mantiene getActiveFareRules para compatibilidad Sprint 25.
 */
import { getActiveCity } from "@/lib/city/context";
import {
  clearTariffConfigCache,
  loadCityTariffConfig,
} from "@/lib/tariff/config-loader";
import type { FareRules } from "@/lib/pricing/types";

/** Invalida cache tarifaria (tests / admin). */
export function clearFareRulesCache(): void {
  clearTariffConfigCache();
}

/**
 * Carga reglas activas de la ciudad activa vía Tariff config-loader.
 */
export async function getActiveFareRules(): Promise<FareRules> {
  const city = await getActiveCity();
  const config = await loadCityTariffConfig(city.slug);

  return {
    id: `city:${config.citySlug}`,
    currency: config.currency,
    flagDrop: config.flagDrop,
    minimumFare: config.minimumFare,
    minDistanceMeters: config.minDistanceMeters,
    incrementMeters: config.incrementMeters,
    incrementAmount: config.incrementAmount,
    waitSeconds: config.waitUnitSeconds,
    waitAmount: config.waitAmount,
    surchargeNight: config.surcharges.night,
    surchargeSundayHoliday: config.surcharges.sundayHoliday,
    surchargeAirport: config.surcharges.airport,
    surchargeWhatxia: config.surcharges.platform,
    nightStartHour: config.nightStartHour,
    nightEndHour: config.nightEndHour,
    holidayDates: config.holidayDates ?? [],
    airportKeywords: config.airport.keywords,
    airportCenterLat: config.airport.centerLat,
    airportCenterLng: config.airport.centerLng,
    airportRadiusMeters: config.airport.radiusMeters,
  };
}
