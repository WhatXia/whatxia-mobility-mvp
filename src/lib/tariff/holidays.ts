/**
 * Festivos nacionales — solo Supabase (public.holidays).
 * No usar date-holidays ni APIs en el Tariff Engine.
 */
import { getSupabase } from "@/lib/supabase/client";

export function toIsoDateLocal(at: Date): string {
  const yyyy = at.getFullYear();
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ¿La fecha (calendario local) es festivo oficial del país?
 */
export async function isPublicHoliday(
  countryCode: string,
  at: Date,
): Promise<boolean> {
  const code = countryCode.trim().toUpperCase();
  if (!code) {
    return false;
  }

  const isoDate = toIsoDateLocal(at);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("holidays")
    .select("id")
    .eq("country_code", code)
    .eq("holiday_date", isoDate)
    .maybeSingle();

  if (error) {
    console.error("[tariff:holidays] error al consultar holidays:", error);
    throw error;
  }

  return Boolean(data);
}

/** Domingo o festivo → un solo flag (recargo una vez). */
export function isSundayOrPublicHoliday(
  at: Date,
  isHoliday: boolean,
): boolean {
  return at.getDay() === 0 || isHoliday;
}
