import { getSupabase } from "@/lib/supabase/client";
import type { FareRules } from "@/lib/pricing/types";
import { getActiveCity } from "@/lib/city/context";

type FareRulesRow = {
  id: string;
  currency: string;
  flag_drop: number;
  minimum_fare: number;
  min_distance_meters: number;
  increment_meters: number;
  increment_amount: number;
  wait_seconds: number;
  wait_amount: number;
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
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function mapFareRulesRow(row: FareRulesRow): FareRules {
  return {
    id: row.id,
    currency: row.currency,
    flagDrop: row.flag_drop,
    minimumFare: row.minimum_fare,
    minDistanceMeters: row.min_distance_meters,
    incrementMeters: row.increment_meters,
    incrementAmount: row.increment_amount,
    waitSeconds: row.wait_seconds,
    waitAmount: row.wait_amount,
    surchargeNight: row.surcharge_night,
    surchargeSundayHoliday: row.surcharge_sunday_holiday,
    surchargeAirport: row.surcharge_airport,
    surchargeWhatxia: row.surcharge_whatxia,
    nightStartHour: row.night_start_hour,
    nightEndHour: row.night_end_hour,
    holidayDates: asStringArray(row.holiday_dates),
    airportKeywords: asStringArray(row.airport_keywords),
    airportCenterLat: row.airport_center_lat,
    airportCenterLng: row.airport_center_lng,
    airportRadiusMeters: row.airport_radius_meters,
  };
}

const CACHE_TTL_MS = 60_000;
let cached: { cityId: string; rules: FareRules; loadedAt: number } | null =
  null;

/** Invalida cache (tests / admin). */
export function clearFareRulesCache(): void {
  cached = null;
}

/**
 * Carga la fila activa de fare_rules para la ciudad activa.
 * Sin defaults en código: si no hay fila, falla.
 */
export async function getActiveFareRules(): Promise<FareRules> {
  const city = await getActiveCity();

  if (
    cached &&
    cached.cityId === city.id &&
    Date.now() - cached.loadedAt < CACHE_TTL_MS
  ) {
    return cached.rules;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fare_rules")
    .select(
      "id, currency, flag_drop, minimum_fare, min_distance_meters, increment_meters, increment_amount, wait_seconds, wait_amount, surcharge_night, surcharge_sunday_holiday, surcharge_airport, surcharge_whatxia, night_start_hour, night_end_hour, holiday_dates, airport_keywords, airport_center_lat, airport_center_lng, airport_radius_meters",
    )
    .eq("active", true)
    .eq("city_id", city.id)
    .maybeSingle();

  if (error) {
    console.error("[pricing] error al leer fare_rules:", error);
    throw error;
  }

  if (!data) {
    throw new Error(
      `No hay fare_rules activas para la ciudad ${city.slug}. Aplica migraciones 015–017.`,
    );
  }

  const rules = mapFareRulesRow(data as FareRulesRow);
  cached = { cityId: city.id, rules, loadedAt: Date.now() };
  return rules;
}
