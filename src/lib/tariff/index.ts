/**
 * Tariff Engine — punto de entrada.
 *
 * SSoT en cálculo:
 * - Parámetros: `public.fare_rules`
 * - Festivos: `public.holidays` (por country_code)
 * Sin APIs ni date-holidays en runtime.
 */

export {
  estimateFare,
  finalizeFare,
  formatTariffCop,
  resolveCityTariff,
  setTariffProvider,
  resetTariffProvider,
} from "@/lib/tariff/engine";

export {
  calculateTariff,
  appliesSundayHolidaySurcharge,
} from "@/lib/tariff/calculator";
export {
  loadCityTariffConfig,
  clearTariffConfigCache,
  mapFareRulesRowToCityTariff,
} from "@/lib/tariff/config-loader";
export {
  isPublicHoliday,
  isSundayOrPublicHoliday,
  toIsoDateLocal,
} from "@/lib/tariff/holidays";
export { tariffQuoteToFareQuote } from "@/lib/tariff/adapters";
export { deriveWaitSecondsFromSpeed } from "@/lib/tariff/waiting";

export type {
  CityTariffConfig,
  EstimateFareInput,
  FinalizeFareInput,
  TariffBreakdown,
  TariffKind,
  TariffProvider,
  TariffQuote,
  GeoRef,
} from "@/lib/tariff/types";
export type { FareRulesDbRow } from "@/lib/tariff/config-loader";
