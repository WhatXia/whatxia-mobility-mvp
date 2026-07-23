/**
 * @deprecated NO USAR EN RUNTIME.
 * El Tariff Engine carga solo desde Supabase (`loadCityTariffConfig`).
 * Nueva ciudad = filas en `cities` + `fare_rules`, sin tocar este archivo.
 */
import { ibagueTariff } from "@/lib/tariff/city-config/ibague";
import { medellinTariff } from "@/lib/tariff/city-config/medellin";
import { pastoTariff } from "@/lib/tariff/city-config/pasto";
import type { CityTariffConfig } from "@/lib/tariff/types";

const CITY_TARIFF_SEEDS: Record<string, CityTariffConfig> = {
  [ibagueTariff.citySlug]: ibagueTariff,
  [medellinTariff.citySlug]: medellinTariff,
  [pastoTariff.citySlug]: pastoTariff,
};

/** @deprecated */
export function listTariffCitySlugs(): string[] {
  return Object.keys(CITY_TARIFF_SEEDS);
}

/** @deprecated */
export function getCityTariffConfig(citySlug: string): CityTariffConfig {
  const normalized = citySlug.trim().toLowerCase();
  const config = CITY_TARIFF_SEEDS[normalized];
  if (!config) {
    throw new Error(
      `Deprecated seed lookup for "${citySlug}". Use loadCityTariffConfig (fare_rules).`,
    );
  }
  return config;
}
