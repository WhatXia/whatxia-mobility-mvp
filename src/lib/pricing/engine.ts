/**
 * Compatibilidad — Mobility debe preferir `@/lib/tariff`.
 * Este módulo delega al Tariff Engine (config = Supabase fare_rules).
 */
import type { FareQuote, RouteEstimate } from "@/lib/geo/types";
import { getActiveCity } from "@/lib/city/context";
import {
  calculateTariff,
  formatTariffCop,
  loadCityTariffConfig,
  tariffQuoteToFareQuote,
  type CityTariffConfig,
} from "@/lib/tariff";
import type { FareContext, FareRules } from "@/lib/pricing/types";

export type { FareRules, FareContext };

export function formatFareCop(amount: number): string {
  return formatTariffCop(amount);
}

/** @deprecated Usar CityTariffConfig vía @/lib/tariff */
function fareRulesToCityConfig(
  rules: FareRules,
  citySlug: string,
): CityTariffConfig {
  return {
    citySlug,
    cityName: citySlug,
    currency: "COP",
    flagDrop: rules.flagDrop,
    minimumFare: rules.minimumFare,
    minDistanceMeters: rules.minDistanceMeters,
    incrementMeters: rules.incrementMeters,
    incrementAmount: rules.incrementAmount,
    timeUnitSeconds: 0,
    timeAmount: 0,
    waitUnitSeconds: rules.waitSeconds,
    waitAmount: rules.waitAmount,
    waitSpeedThresholdKmh: 5,
    surcharges: {
      night: rules.surchargeNight,
      sundayHoliday: rules.surchargeSundayHoliday,
      airport: rules.surchargeAirport,
      platform: rules.surchargeWhatxia,
    },
    nightStartHour: rules.nightStartHour,
    nightEndHour: rules.nightEndHour,
    holidayDates: rules.holidayDates,
    airport: {
      keywords: rules.airportKeywords,
      centerLat: rules.airportCenterLat,
      centerLng: rules.airportCenterLng,
      radiusMeters: rules.airportRadiusMeters,
    },
  };
}

/**
 * @deprecated Preferir estimateFare / calculateTariff desde @/lib/tariff.
 * Mantiene firma Sprint 25 para certify (inyecta FareRules fixture).
 */
export function calculateFareWithRules(
  route: RouteEstimate,
  rules: FareRules,
  context: FareContext = {},
): FareQuote {
  const config = fareRulesToCityConfig(rules, "legacy");
  const waitSeconds = context.waitSeconds ?? 0;
  const quote = calculateTariff({
    kind: "estimated",
    config,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    waitSeconds,
    waitSource: waitSeconds > 0 ? "provided" : "none",
    at: context.at ?? new Date(),
    origin: {
      lat: context.pickupLat ?? 0,
      lng: context.pickupLng ?? 0,
      label: context.pickupLabel,
    },
    destination: {
      lat: context.dropoffLat ?? 0,
      lng: context.dropoffLng ?? 0,
      label: context.dropoffLabel,
    },
    provider: "pricing_compat",
  });
  return tariffQuoteToFareQuote(quote);
}

/** Cotización vía Tariff Engine (config Supabase de la ciudad activa). */
export async function calculateFare(
  route: RouteEstimate,
  context: FareContext = {},
): Promise<FareQuote> {
  const city = await getActiveCity();
  const config = await loadCityTariffConfig(city.slug);
  const waitSeconds = context.waitSeconds ?? 0;
  const quote = calculateTariff({
    kind: "estimated",
    config,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    waitSeconds,
    waitSource: waitSeconds > 0 ? "provided" : "none",
    at: context.at ?? new Date(),
    origin: {
      lat: context.pickupLat ?? 0,
      lng: context.pickupLng ?? 0,
      label: context.pickupLabel,
    },
    destination: {
      lat: context.dropoffLat ?? 0,
      lng: context.dropoffLng ?? 0,
      label: context.dropoffLabel,
    },
    provider: "pricing_compat",
  });
  return tariffQuoteToFareQuote(quote);
}
