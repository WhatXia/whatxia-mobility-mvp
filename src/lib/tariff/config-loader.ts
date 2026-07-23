/**
 * Single Source of Truth — carga CityTariffConfig desde public.fare_rules.
 * Fail-closed: sin fila activa para el slug → error (sin fallback a archivos).
 */
import { getSupabase } from "@/lib/supabase/client";
import type { CityTariffConfig } from "@/lib/tariff/types";

export type FareRulesDbRow = {
  id: string;
  currency: string;
  flag_drop: number;
  minimum_fare: number;
  min_distance_meters: number;
  increment_meters: number;
  increment_amount: number;
  wait_seconds: number;
  wait_amount: number;
  time_unit_seconds: number;
  time_amount: number;
  wait_speed_threshold_kmh: number | string;
  surcharge_night: number;
  surcharge_sunday_holiday: number;
  surcharge_airport: number;
  surcharge_whatxia: number;
  night_start_hour: number;
  night_end_hour: number;
  holiday_dates: unknown;
  airport_keywords: unknown;
  airport_center_lat: number | null;
  airport_center_lng: number | null;
  airport_radius_meters: number | null;
  cities: {
    slug: string;
    name: string;
  } | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asNumber(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Mapeo puro DB → CityTariffConfig (testeable sin red). */
export function mapFareRulesRowToCityTariff(
  row: FareRulesDbRow,
): CityTariffConfig {
  const slug = row.cities?.slug;
  const name = row.cities?.name;
  if (!slug || !name) {
    throw new Error(
      "Tariff config: fila fare_rules sin ciudad asociada (cities).",
    );
  }

  return {
    citySlug: slug,
    cityName: name,
    currency: "COP",
    flagDrop: row.flag_drop,
    minimumFare: row.minimum_fare,
    minDistanceMeters: row.min_distance_meters,
    incrementMeters: row.increment_meters,
    incrementAmount: row.increment_amount,
    timeUnitSeconds: row.time_unit_seconds ?? 0,
    timeAmount: row.time_amount ?? 0,
    waitUnitSeconds: row.wait_seconds,
    waitAmount: row.wait_amount,
    waitSpeedThresholdKmh: asNumber(row.wait_speed_threshold_kmh, 5),
    surcharges: {
      night: row.surcharge_night,
      sundayHoliday: row.surcharge_sunday_holiday,
      airport: row.surcharge_airport,
      platform: row.surcharge_whatxia,
    },
    nightStartHour: row.night_start_hour,
    nightEndHour: row.night_end_hour,
    holidayDates: asStringArray(row.holiday_dates),
    airport: {
      keywords: asStringArray(row.airport_keywords),
      centerLat: row.airport_center_lat,
      centerLng: row.airport_center_lng,
      radiusMeters: row.airport_radius_meters,
    },
  };
}

/**
 * Sin cache: un UPDATE en fare_rules debe reflejarse en la siguiente cotización
 * sin redeploy. clearTariffConfigCache se mantiene por compat de tests.
 */
export function clearTariffConfigCache(): void {
  // no-op (ya no hay cache en memoria)
}

/**
 * Carga la configuración tarifaria activa para un citySlug desde Supabase.
 * Única fuente operativa — no hay fallback a city-config/*.ts.
 */
export async function loadCityTariffConfig(
  citySlug: string,
): Promise<CityTariffConfig> {
  const normalized = citySlug.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Tariff config: citySlug vacío.");
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fare_rules")
    .select(
      `
      id,
      currency,
      flag_drop,
      minimum_fare,
      min_distance_meters,
      increment_meters,
      increment_amount,
      wait_seconds,
      wait_amount,
      time_unit_seconds,
      time_amount,
      wait_speed_threshold_kmh,
      surcharge_night,
      surcharge_sunday_holiday,
      surcharge_airport,
      surcharge_whatxia,
      night_start_hour,
      night_end_hour,
      holiday_dates,
      airport_keywords,
      airport_center_lat,
      airport_center_lng,
      airport_radius_meters,
      cities!inner ( slug, name )
    `,
    )
    .eq("active", true)
    .eq("cities.slug", normalized)
    .maybeSingle();

  if (error) {
    console.error("[tariff:config] error al leer fare_rules:", error);
    throw error;
  }

  if (!data) {
    throw new Error(
      `Tariff Engine: no hay fare_rules activas para la ciudad "${normalized}". ` +
        "Inserta la ciudad en cities y una fila activa en fare_rules (migraciones 015–022).",
    );
  }

  // Supabase tipa el embed de formas distintas según versión.
  const raw = data as unknown as FareRulesDbRow & {
    cities: FareRulesDbRow["cities"] | FareRulesDbRow["cities"][];
  };
  const cities = Array.isArray(raw.cities) ? raw.cities[0] ?? null : raw.cities;
  return mapFareRulesRowToCityTariff({ ...raw, cities });
}
