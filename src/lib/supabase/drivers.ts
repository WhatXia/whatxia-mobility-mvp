import { getSupabase } from "@/lib/supabase/client";

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

  const { data, error } = await supabase
    .from("drivers")
    .select("id, phone, name, plate, is_available, created_at")
    .eq("phone", phone)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar conductor:", error);
    throw error;
  }

  return data;
}

export async function listAvailableDrivers(): Promise<DriverRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("id, phone, name, plate, is_available, created_at")
    .eq("is_available", true);

  if (error) {
    console.error("[supabase] error al listar conductores:", error);
    throw error;
  }

  return data ?? [];
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

export async function createDriver(input: {
  phone: string;
  name: string;
  plate: string;
}): Promise<DriverRow> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      phone: input.phone,
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
