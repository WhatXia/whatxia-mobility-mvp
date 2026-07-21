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
