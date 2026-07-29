import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";
import { getActiveCity } from "@/lib/city/context";
import {
  defaultStatusForNewPassenger,
  isPassengerStatus,
  type PassengerStatus,
} from "@/lib/passenger-status";
import {
  isRegistrationSource,
  type RegistrationSource,
} from "@/lib/registration-source";
import { applyPendingReferralForPassenger } from "@/lib/referrals";

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
  registered_at: string;
  city_id: string | null;
  status: PassengerStatus;
  registration_source: RegistrationSource | null;
  /** Conductor referente (una sola vez). */
  referred_by_driver_id: string | null;
};

const PASSENGER_COLUMNS =
  "id, phone, name, full_name, preferred_name, whatsapp_name, no_show_count, created_at, registered_at, city_id, status, registration_source, referred_by_driver_id";

function mapPassenger(data: PassengerRow): PassengerRow {
  const status = isPassengerStatus(data.status) ? data.status : "ACTIVE";
  const registration_source = isRegistrationSource(data.registration_source)
    ? data.registration_source
    : null;
  return {
    ...data,
    full_name: data.full_name ?? null,
    preferred_name: data.preferred_name ?? null,
    whatsapp_name: data.whatsapp_name ?? null,
    no_show_count: data.no_show_count ?? 0,
    city_id: data.city_id ?? null,
    registered_at: data.registered_at ?? data.created_at,
    status,
    registration_source,
    referred_by_driver_id: data.referred_by_driver_id ?? null,
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

export async function findPassengerById(
  id: string,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("passengers")
    .select(PASSENGER_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar pasajero por id:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

/**
 * Crea o reutiliza pasajero.
 * `whatsappName` solo actualiza whatsapp_name (referencia).
 * Status inicial de nuevos: PIONEER o ACTIVE según PRE_LAUNCH_MODE.
 * REF-003: si hay código de referido pendiente, atribuye sin cambiar el onboarding.
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
    let passenger = existing;
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
      passenger = mapPassenger(data as PassengerRow);
    } else {
      console.log("[passenger] reutilizado:", {
        id: existing.id,
        phone: existing.phone,
        cityId: existing.city_id,
        status: existing.status,
        hasIdentity: hasCompleteIdentity(existing),
      });
    }

    // REF-003: si hay pending y aún no tiene referente, atribuye; nunca sobrescribe.
    if (!passenger.referred_by_driver_id) {
      await applyPendingReferralForPassenger(phone, passenger.id).catch(
        (err) => {
          console.error("[referrals] apply pending (existente):", err);
        },
      );
      return (await findPassengerByPhone(phone)) ?? passenger;
    }

    return passenger;
  }

  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const status = defaultStatusForNewPassenger();

  const { data, error } = await supabase
    .from("passengers")
    .insert({
      phone: normalized,
      name: null,
      full_name: null,
      preferred_name: null,
      whatsapp_name: wa,
      city_id: city.id,
      status,
      registered_at: new Date().toISOString(),
    })
    .select(PASSENGER_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      const again = await findPassengerByPhone(phone);
      if (again) {
        await applyPendingReferralForPassenger(phone, again.id).catch(
          (err) => {
            console.error("[referrals] apply pending (race):", err);
          },
        );
        return (await findPassengerByPhone(phone)) ?? again;
      }
    }

    console.error("[supabase] error al crear pasajero:", error);
    throw error;
  }

  console.log("[passenger] creado:", {
    id: data.id,
    phone: data.phone,
    cityId: data.city_id,
    status: data.status,
  });

  const created = mapPassenger(data as PassengerRow);
  await applyPendingReferralForPassenger(phone, created.id).catch((err) => {
    console.error("[referrals] apply pending (nuevo):", err);
  });

  return (await findPassengerByPhone(phone)) ?? created;
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

export async function setPassengerRegistrationSource(
  phone: string,
  source: RegistrationSource,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("passengers")
    .update({ registration_source: source })
    .eq("phone", normalized)
    .select(PASSENGER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[passenger] error al guardar registration_source:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

export async function updatePassengerStatus(
  passengerId: string,
  status: PassengerStatus,
): Promise<PassengerRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("passengers")
    .update({ status })
    .eq("id", passengerId)
    .select(PASSENGER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[passenger] error al actualizar status:", error);
    throw error;
  }

  return data ? mapPassenger(data as PassengerRow) : null;
}

export async function updatePassengersStatusBulk(
  passengerIds: string[],
  status: PassengerStatus,
): Promise<number> {
  if (passengerIds.length === 0) return 0;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("passengers")
    .update({ status })
    .in("id", passengerIds)
    .select("id");

  if (error) {
    console.error("[passenger] error al actualizar status masivo:", error);
    throw error;
  }

  return data?.length ?? 0;
}

export type ListPassengersFilter = "all" | PassengerStatus;

export type PassengerStatusCounts = Record<PassengerStatus, number> & {
  total: number;
  pioneersToday: number;
};

export async function getPassengerStatusCounts(): Promise<PassengerStatusCounts> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("passengers")
    .select("status, registered_at");

  if (error) {
    console.error("[passenger] error al contar status:", error);
    throw error;
  }

  const counts: PassengerStatusCounts = {
    PIONEER: 0,
    BETA: 0,
    ACTIVE: 0,
    BLOCKED: 0,
    total: 0,
    pioneersToday: 0,
  };

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  for (const row of data ?? []) {
    const status = isPassengerStatus(row.status) ? row.status : "ACTIVE";
    counts[status] += 1;
    counts.total += 1;
    if (status === "PIONEER") {
      const registered = new Date(
        String(row.registered_at ?? ""),
      ).getTime();
      if (Number.isFinite(registered) && registered >= startOfUtcDay.getTime()) {
        counts.pioneersToday += 1;
      }
    }
  }

  return counts;
}

export async function listPassengers(options?: {
  status?: ListPassengersFilter;
  query?: string;
  limit?: number;
}): Promise<PassengerRow[]> {
  const supabase = getSupabase();
  const limit = options?.limit ?? 300;
  let dbQuery = supabase
    .from("passengers")
    .select(PASSENGER_COLUMNS)
    .order("registered_at", { ascending: false })
    .limit(limit);

  if (options?.status && options.status !== "all") {
    dbQuery = dbQuery.eq("status", options.status);
  }

  const { data, error } = await dbQuery;
  if (error) {
    console.error("[passenger] error al listar:", error);
    throw error;
  }

  let rows = (data as PassengerRow[]).map(mapPassenger);
  const q = options?.query?.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    rows = rows.filter((row) => {
      const full = (row.full_name ?? "").toLowerCase();
      const preferred = (row.preferred_name ?? row.name ?? "").toLowerCase();
      const phone = row.phone;
      return (
        full.includes(q) ||
        preferred.includes(q) ||
        (digits.length > 0 && phone.includes(digits)) ||
        phone.includes(q)
      );
    });
  }

  return rows;
}
