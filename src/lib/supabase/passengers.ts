import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";
import { getActiveCity } from "@/lib/city/context";

export type PassengerRow = {
  id: string;
  phone: string;
  name: string | null;
  no_show_count: number;
  created_at: string;
  city_id: string | null;
};

function mapPassenger(data: PassengerRow): PassengerRow {
  return {
    ...data,
    no_show_count: data.no_show_count ?? 0,
    city_id: data.city_id ?? null,
  };
}

export async function findPassengerByPhone(
  phone: string,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .select("id, phone, name, no_show_count, created_at, city_id")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar pasajero:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

export async function findOrCreatePassenger(
  phone: string,
  name?: string,
): Promise<PassengerRow> {
  const existing = await findPassengerByPhone(phone);
  const city = await getActiveCity();

  if (existing) {
    if (!existing.city_id) {
      const supabase = getSupabase();
      await supabase
        .from("passengers")
        .update({ city_id: city.id })
        .eq("id", existing.id);
      existing.city_id = city.id;
    }
    console.log("[passenger] reutilizado:", {
      id: existing.id,
      phone: existing.phone,
      cityId: existing.city_id,
    });
    return existing;
  }

  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const trimmedName = name?.trim() || null;

  const { data, error } = await supabase
    .from("passengers")
    .insert({
      phone: normalized,
      name: trimmedName,
      city_id: city.id,
    })
    .select("id, phone, name, no_show_count, created_at, city_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const again = await findPassengerByPhone(phone);
      if (again) {
        return again;
      }
    }

    console.error("[supabase] error al crear pasajero:", error);
    throw error;
  }

  console.log("[passenger] creado:", {
    id: data.id,
    phone: data.phone,
    cityId: data.city_id,
  });

  return mapPassenger(data as PassengerRow);
}
