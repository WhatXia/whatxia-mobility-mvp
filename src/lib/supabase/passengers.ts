import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";

export type PassengerRow = {
  id: string;
  phone: string;
  name: string | null;
  no_show_count: number;
  created_at: string;
};

function mapPassenger(data: PassengerRow): PassengerRow {
  return {
    ...data,
    no_show_count: data.no_show_count ?? 0,
  };
}

export async function findPassengerByPhone(
  phone: string,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .select("id, phone, name, no_show_count, created_at")
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

  if (existing) {
    console.log("[passenger] reutilizado:", {
      id: existing.id,
      phone: existing.phone,
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
    })
    .select("id, phone, name, no_show_count, created_at")
    .single();

  if (error) {
    // Carrera: otro request pudo crearlo al mismo tiempo.
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
  });

  return mapPassenger(data as PassengerRow);
}
