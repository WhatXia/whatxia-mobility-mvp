import { getSupabase } from "@/lib/supabase/client";

/**
 * Excluye a un conductor de futuras ofertas de este trip_id únicamente.
 * No afecta su elegibilidad en otros viajes.
 */
export async function addTripDriverExclusion(
  tripId: string,
  driverId: string,
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("trip_driver_exclusions").upsert(
    {
      trip_id: tripId,
      driver_id: driverId,
    },
    { onConflict: "trip_id,driver_id" },
  );

  if (error) {
    console.error("[exclusion] error al registrar:", error);
    throw error;
  }

  console.log("[exclusion:add]", { tripId, driverId });
}

export async function listExcludedDriverIdsForTrip(
  tripId: string,
): Promise<string[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("trip_driver_exclusions")
    .select("driver_id")
    .eq("trip_id", tripId);

  if (error) {
    console.error("[exclusion] error al listar:", error);
    throw error;
  }

  return (data ?? []).map((row) => row.driver_id as string);
}

/** Lógica pura: filtrar elegibles por exclusiones del viaje. */
export function filterDriversForTripOffer<T extends { id: string }>(input: {
  drivers: T[];
  excludedDriverIds: string[];
  excludePhoneMatch?: (driver: T) => boolean;
}): T[] {
  const excluded = new Set(input.excludedDriverIds);

  return input.drivers.filter((driver) => {
    if (excluded.has(driver.id)) {
      return false;
    }
    if (input.excludePhoneMatch?.(driver)) {
      return false;
    }
    return true;
  });
}

export function isDriverExcludedFromTrip(
  driverId: string,
  excludedDriverIds: string[],
): boolean {
  return excludedDriverIds.includes(driverId);
}
