/**
 * Persistencia y reglas de negocio del programa de referidos (REF-003).
 */

import { getSupabase } from "@/lib/supabase/client";
import type { DriverRow } from "@/lib/supabase/drivers";
import { normalizePhone } from "@/lib/trips";
import {
  buildReferralLink,
  generateReferralCode,
  isValidReferralCodeFormat,
  normalizeReferralCode,
} from "@/lib/referrals/codes";

export type ReferralEventType =
  | "link_opened"
  | "link_shared"
  | "passenger_registered";

export type ReferralAttributionRow = {
  id: string;
  referrer_driver_id: string;
  passenger_id: string;
  referral_code: string;
  created_at: string;
};

export type ReferralDriverStats = {
  driverId: string;
  referralCode: string | null;
  referralLink: string | null;
  totalReferrals: number;
};

/** Conductor válido para atribuir referidos. */
export function isActiveReferrerDriver(
  driver: Pick<DriverRow, "status" | "documents_blocked"> | null | undefined,
): boolean {
  if (!driver) return false;
  return driver.status === "active" && !driver.documents_blocked;
}

export async function findDriverByReferralCode(
  code: string,
): Promise<DriverRow | null> {
  if (!isValidReferralCodeFormat(code)) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("referral_code", normalizeReferralCode(code))
    .maybeSingle();

  if (error) {
    console.error("[referrals] error al buscar código:", error);
    throw error;
  }
  return (data as DriverRow | null) ?? null;
}

/**
 * Obtiene o genera el código único del conductor.
 */
export async function getOrCreateDriverReferralCode(
  driver: DriverRow,
): Promise<string> {
  if (driver.referral_code && isValidReferralCodeFormat(driver.referral_code)) {
    return normalizeReferralCode(driver.referral_code);
  }

  const supabase = getSupabase();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateReferralCode();
    const { data, error } = await supabase
      .from("drivers")
      .update({ referral_code: code })
      .eq("id", driver.id)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") continue;
      console.error("[referrals] error al asignar código:", error);
      throw error;
    }

    if (data?.referral_code) {
      return normalizeReferralCode(String(data.referral_code));
    }

    // Otro proceso pudo haber asignado el código; re-leer.
    const { data: again } = await supabase
      .from("drivers")
      .select("referral_code")
      .eq("id", driver.id)
      .maybeSingle();
    if (again?.referral_code) {
      return normalizeReferralCode(String(again.referral_code));
    }
  }

  throw new Error("No se pudo generar referral_code único para el conductor.");
}

export async function getDriverReferralLink(driver: DriverRow): Promise<{
  code: string;
  link: string;
}> {
  const code = await getOrCreateDriverReferralCode(driver);
  return { code, link: buildReferralLink(code) };
}

export async function recordReferralEvent(input: {
  eventType: ReferralEventType;
  referralCode: string;
  referrerDriverId?: string | null;
  passengerId?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("referral_events").insert({
    event_type: input.eventType,
    referral_code: normalizeReferralCode(input.referralCode),
    referrer_driver_id: input.referrerDriverId ?? null,
    passenger_id: input.passengerId ?? null,
    meta: input.meta ?? null,
  });

  if (error) {
    console.error("[referrals] error al registrar evento:", error);
    throw error;
  }
}

export async function stashPendingReferralCode(
  phone: string,
  code: string,
): Promise<void> {
  if (!isValidReferralCodeFormat(code)) return;
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const { error } = await supabase.from("referral_pending").upsert(
    {
      phone: normalized,
      referral_code: normalizeReferralCode(code),
      created_at: new Date().toISOString(),
    },
    { onConflict: "phone" },
  );
  if (error) {
    console.error("[referrals] error al guardar pending:", error);
    throw error;
  }
}

export async function consumePendingReferralCode(
  phone: string,
): Promise<string | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const { data, error } = await supabase
    .from("referral_pending")
    .select("referral_code")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[referrals] error al leer pending:", error);
    throw error;
  }

  if (!data?.referral_code) return null;

  await supabase.from("referral_pending").delete().eq("phone", normalized);
  return normalizeReferralCode(String(data.referral_code));
}

export async function peekPendingReferralCode(
  phone: string,
): Promise<string | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const { data, error } = await supabase
    .from("referral_pending")
    .select("referral_code")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[referrals] error al peek pending:", error);
    throw error;
  }
  return data?.referral_code
    ? normalizeReferralCode(String(data.referral_code))
    : null;
}

type AttributeResult =
  | { ok: true; attributed: true; driverId: string; code: string }
  | { ok: true; attributed: false; reason: string }
  | { ok: false; reason: string };

/**
 * Asocia pasajero nuevo con conductor referente.
 * Nunca sobrescribe referred_by_driver_id existente.
 */
export async function attributePassengerReferral(
  passengerId: string,
  code: string,
): Promise<AttributeResult> {
  if (!isValidReferralCodeFormat(code)) {
    return { ok: true, attributed: false, reason: "invalid_code" };
  }

  const normalized = normalizeReferralCode(code);
  const supabase = getSupabase();

  const { data: passenger, error: pErr } = await supabase
    .from("passengers")
    .select("id, referred_by_driver_id, registration_source")
    .eq("id", passengerId)
    .maybeSingle();

  if (pErr) {
    console.error("[referrals] error al leer pasajero:", pErr);
    return { ok: false, reason: "passenger_read_error" };
  }
  if (!passenger) {
    return { ok: false, reason: "passenger_not_found" };
  }

  if (passenger.referred_by_driver_id) {
    return { ok: true, attributed: false, reason: "already_attributed" };
  }

  const driver = await findDriverByReferralCode(normalized);
  if (!driver) {
    return { ok: true, attributed: false, reason: "code_not_found" };
  }
  if (!isActiveReferrerDriver(driver)) {
    return { ok: true, attributed: false, reason: "driver_not_active" };
  }

  const patch: Record<string, string> = {
    referred_by_driver_id: driver.id,
  };
  if (!passenger.registration_source) {
    patch.registration_source = "REFERRAL";
  }

  const { error: uErr } = await supabase
    .from("passengers")
    .update(patch)
    .eq("id", passengerId)
    .is("referred_by_driver_id", null);

  if (uErr) {
    console.error("[referrals] error al atribuir pasajero:", uErr);
    return { ok: false, reason: "passenger_update_error" };
  }

  const { error: aErr } = await supabase.from("referral_attributions").insert({
    referrer_driver_id: driver.id,
    passenger_id: passengerId,
    referral_code: normalized,
  });

  if (aErr) {
    // Unique passenger → ya atribuido por carrera; no fallar duro.
    if (aErr.code !== "23505") {
      console.error("[referrals] error al insertar attribution:", aErr);
      return { ok: false, reason: "attribution_insert_error" };
    }
    return { ok: true, attributed: false, reason: "already_attributed" };
  }

  await recordReferralEvent({
    eventType: "passenger_registered",
    referralCode: normalized,
    referrerDriverId: driver.id,
    passengerId,
    meta: {
      link: buildReferralLink(normalized),
    },
  });

  console.log("[referrals] atribución OK", {
    passengerId,
    driverId: driver.id,
    code: normalized,
  });

  return {
    ok: true,
    attributed: true,
    driverId: driver.id,
    code: normalized,
  };
}

/**
 * Tras crear un pasajero: consume pending y atribuye si aplica.
 * Usuarios existentes: no sobrescribe (attributePassengerReferral lo garantiza).
 */
export async function applyPendingReferralForPassenger(
  phone: string,
  passengerId: string,
): Promise<AttributeResult> {
  const code = await consumePendingReferralCode(phone);
  if (!code) {
    return { ok: true, attributed: false, reason: "no_pending_code" };
  }
  return attributePassengerReferral(passengerId, code);
}

/**
 * Captura código desde mensaje WhatsApp (stash + auditoría link_shared).
 */
export async function captureReferralCodeFromInbound(
  phone: string,
  text: string | null,
): Promise<string | null> {
  const { extractReferralCodeFromText } = await import("@/lib/referrals/codes");
  const code = extractReferralCodeFromText(text);
  if (!code) return null;

  const driver = await findDriverByReferralCode(code);
  await stashPendingReferralCode(phone, code);

  await recordReferralEvent({
    eventType: "link_shared",
    referralCode: code,
    referrerDriverId: driver?.id ?? null,
    meta: { phone: normalizePhone(phone), source: "whatsapp_inbound" },
  }).catch((err) => {
    console.error("[referrals] evento link_shared:", err);
  });

  return code;
}

/** Stats que consume el módulo Ops de Referidos. */
export async function getReferralStatsForDriver(
  driverId: string,
): Promise<ReferralDriverStats> {
  const supabase = getSupabase();
  const { data: driver } = await supabase
    .from("drivers")
    .select("id, referral_code")
    .eq("id", driverId)
    .maybeSingle();

  const code = driver?.referral_code
    ? normalizeReferralCode(String(driver.referral_code))
    : null;

  const { count } = await supabase
    .from("referral_attributions")
    .select("id", { count: "exact", head: true })
    .eq("referrer_driver_id", driverId);

  return {
    driverId,
    referralCode: code,
    referralLink: code ? buildReferralLink(code) : null,
    totalReferrals: count ?? 0,
  };
}

export async function listReferralAttributionsForDriver(
  driverId: string,
): Promise<ReferralAttributionRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("referral_attributions")
    .select("id, referrer_driver_id, passenger_id, referral_code, created_at")
    .eq("referrer_driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[referrals] error al listar attributions:", error);
    throw error;
  }
  return (data as ReferralAttributionRow[]) ?? [];
}
