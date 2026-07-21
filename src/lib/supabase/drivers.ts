import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone, samePhone } from "@/lib/trips";

export type DriverRow = {
  id: string;
  phone: string;
  name: string;
  plate: string;
  is_available: boolean;
  created_at: string;
};

export async function findDriverByPhone(
  phone: string,
): Promise<DriverRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("drivers")
    .select("id, phone, name, plate, is_available, created_at")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar conductor:", error);
    throw error;
  }

  if (data) {
    return data;
  }

  // Compatibilidad con registros antiguos sin normalizar.
  if (phone !== normalized) {
    const { data: legacy, error: legacyError } = await supabase
      .from("drivers")
      .select("id, phone, name, plate, is_available, created_at")
      .eq("phone", phone)
      .maybeSingle();

    if (legacyError) {
      console.error(
        "[supabase] error al buscar conductor (legacy):",
        legacyError,
      );
      throw legacyError;
    }

    return legacy;
  }

  return null;
}

export async function listAvailableDrivers(options?: {
  excludePhone?: string;
  excludeDriverId?: string;
}): Promise<DriverRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("id, phone, name, plate, is_available, created_at")
    .eq("is_available", true);

  if (error) {
    console.error("[supabase] error al listar conductores:", error);
    throw error;
  }

  const drivers = data ?? [];

  return drivers.filter((driver) => {
    if (options?.excludeDriverId && driver.id === options.excludeDriverId) {
      return false;
    }

    if (
      options?.excludePhone &&
      samePhone(driver.phone, options.excludePhone)
    ) {
      return false;
    }

    return true;
  });
}

export async function markDriverUnavailable(driverId: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: false })
    .eq("id", driverId)
    .eq("is_available", true)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar no disponible:", error);
    throw error;
  }

  return data !== null;
}

export async function markDriverAvailable(driverId: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: true })
    .eq("id", driverId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar disponible:", error);
    throw error;
  }

  return data !== null;
}

export async function setDriverAvailability(
  driverId: string,
  isAvailable: boolean,
): Promise<DriverRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: isAvailable })
    .eq("id", driverId)
    .select("id, phone, name, plate, is_available, created_at")
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al actualizar disponibilidad:", error);
    throw error;
  }

  return data;
}

export async function createDriver(input: {
  phone: string;
  name: string;
  plate: string;
}): Promise<DriverRow> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      phone: normalizePhone(input.phone),
      name: input.name,
      plate: input.plate,
      is_available: true,
    })
    .select("id, phone, name, plate, is_available, created_at")
    .single();

  if (error) {
    console.error("[supabase] error al crear conductor:", error);
    throw error;
  }

  return data;
}
