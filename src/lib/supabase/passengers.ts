import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";
import { getActiveCity } from "@/lib/city/context";

export type PassengerRow = {
  id: string;
  phone: string;
  /** Compat: espejo de preferred_name cuando existe. */
  name: string | null;
  full_name: string | null;
  preferred_name: string | null;
  whatsapp_name: string | null;
  no_show_count: number;
  created_at: string;
  city_id: string | null;
};

const PASSENGER_COLUMNS =
  "id, phone, name, full_name, preferred_name, whatsapp_name, no_show_count, created_at, city_id";

function mapPassenger(data: PassengerRow): PassengerRow {
  return {
    ...data,
    full_name: data.full_name ?? null,
    preferred_name: data.preferred_name ?? null,
    whatsapp_name: data.whatsapp_name ?? null,
    no_show_count: data.no_show_count ?? 0,
    city_id: data.city_id ?? null,
  };
}

export function hasFullName(passenger: PassengerRow): boolean {
  return Boolean(passenger.full_name?.trim());
}

export function hasPreferredName(passenger: PassengerRow): boolean {
  return Boolean(passenger.preferred_name?.trim());
}

/** Identidad completa para operar en WhatXia. */
export function hasCompleteIdentity(passenger: PassengerRow): boolean {
  return hasFullName(passenger) && hasPreferredName(passenger);
}

/** Nombre para conversaciones. */
export function getPassengerDisplayName(
  passenger: PassengerRow,
  fallback = "amigo",
): string {
  const preferred = passenger.preferred_name?.trim();
  if (preferred) return preferred;
  const legacy = passenger.name?.trim();
  if (legacy) return legacy;
  return fallback;
}

/** Nombre para compartir identidad (P↔D). */
export function getPassengerFullName(
  passenger: PassengerRow,
  fallback = "Pasajero",
): string {
  const full = passenger.full_name?.trim();
  if (full) return full;
  return getPassengerDisplayName(passenger, fallback);
}

export async function findPassengerByPhone(
  phone: string,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .select(PASSENGER_COLUMNS)
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar pasajero:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

/**
 * Crea o reutiliza pasajero.
 * `whatsappName` solo actualiza whatsapp_name (referencia).
 */
export async function findOrCreatePassenger(
  phone: string,
  whatsappName?: string,
): Promise<PassengerRow> {
  const existing = await findPassengerByPhone(phone);
  const city = await getActiveCity();
  const wa = whatsappName?.trim() || null;

  if (existing) {
    const supabase = getSupabase();
    const patch: Record<string, string> = {};
    if (!existing.city_id) {
      patch.city_id = city.id;
    }
    if (wa && wa !== existing.whatsapp_name) {
      patch.whatsapp_name = wa;
    }
    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from("passengers")
        .update(patch)
        .eq("id", existing.id)
        .select(PASSENGER_COLUMNS)
        .single();
      if (error) {
        console.error("[passenger] error al actualizar referencia:", error);
        throw error;
      }
      return mapPassenger(data as PassengerRow);
    }

    console.log("[passenger] reutilizado:", {
      id: existing.id,
      phone: existing.phone,
      cityId: existing.city_id,
      hasIdentity: hasCompleteIdentity(existing),
    });
    return existing;
  }

  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .insert({
      phone: normalized,
      name: null,
      full_name: null,
      preferred_name: null,
      whatsapp_name: wa,
      city_id: city.id,
    })
    .select(PASSENGER_COLUMNS)
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

export async function setPassengerFullName(
  phone: string,
  fullName: string,
): Promise<PassengerRow | null> {
  const trimmed = fullName.trim();
  if (!trimmed) return null;

  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .update({ full_name: trimmed })
    .eq("phone", normalized)
    .select(PASSENGER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[passenger] error al guardar full_name:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

export async function setPassengerPreferredName(
  phone: string,
  preferredName: string,
): Promise<PassengerRow | null> {
  const trimmed = preferredName.trim();
  if (!trimmed) return null;

  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .update({
      preferred_name: trimmed,
      name: trimmed,
    })
    .eq("phone", normalized)
    .select(PASSENGER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[passenger] error al guardar preferred_name:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}
