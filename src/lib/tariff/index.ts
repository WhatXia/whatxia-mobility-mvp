/**
 * Tariff Engine — punto de entrada.
 *
 * Config SSoT: únicamente Supabase `public.fare_rules`
 * (vía `loadCityTariffConfig`). No hay dependencia operativa de city-config/*.ts.
 *
 * Nueva ciudad: insertar en `cities` + fila activa en `fare_rules` (sin código).
 *
 * @example
 * import { estimateFare, finalizeFare } from "@/lib/tariff";
 */

export {
  estimateFare,
  finalizeFare,
  formatTariffCop,
  resolveCityTariff,
  setTariffProvider,
  resetTariffProvider,
} from "@/lib/tariff/engine";

export { calculateTariff } from "@/lib/tariff/calculator";
export {
  loadCityTariffConfig,
  clearTariffConfigCache,
  mapFareRulesRowToCityTariff,
} from "@/lib/tariff/config-loader";
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
