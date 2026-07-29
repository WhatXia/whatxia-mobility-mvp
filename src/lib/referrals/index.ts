/**
 * Persistencia y reglas de negocio del programa de referidos (REF-003 / REF-004).
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
  | "passenger_registered"
  | "invalid_code"
  | "conversion";

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
  totalClicks: number;
};

export type OpsReferralProgramStats = {
  totalClicks: number;
  totalRegistrations: number;
  totalAttributed: number;
  totalConversions: number;
  /** Pasajeros atribuidos / clics × 100 */
  conversionPercent: number;
};

/** Conversión % (atribuidos ÷ clics). */
export function computeReferralConversionPercent(
  attributed: number,
  clicks: number,
): number {
  if (clicks <= 0) return 0;
  return Math.round((attributed / clicks) * 1000) / 10;
}

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
  const codeRaw = input.referralCode?.trim() || "INVALID";
  const referralCode = isValidReferralCodeFormat(codeRaw)
    ? normalizeReferralCode(codeRaw)
    : codeRaw.slice(0, 64).toUpperCase();

  const { error } = await supabase.from("referral_events").insert({
    event_type: input.eventType,
    referral_code: referralCode,
    referrer_driver_id: input.referrerDriverId ?? null,
    passenger_id: input.passengerId ?? null,
    meta: input.meta ?? null,
  });

  if (error) {
    console.error("[referrals] error al registrar evento:", error);
    throw error;
  }
}

/**
 * Guarda código pendiente: first-write-wins (REF-004).
 * No sobrescribe pending ni pasajeros ya atribuidos.
 */
export async function stashPendingReferralCode(
  phone: string,
  code: string,
): Promise<{ stashed: boolean; reason: string }> {
  if (!isValidReferralCodeFormat(code)) {
    return { stashed: false, reason: "invalid_code" };
  }
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const normalizedCode = normalizeReferralCode(code);

  const { data: passenger } = await supabase
    .from("passengers")
    .select("referred_by_driver_id")
    .eq("phone", normalized)
    .maybeSingle();

  if (passenger?.referred_by_driver_id) {
    return { stashed: false, reason: "already_attributed" };
  }

  const { data: pending } = await supabase
    .from("referral_pending")
    .select("referral_code")
    .eq("phone", normalized)
    .maybeSingle();

  if (pending?.referral_code) {
    return { stashed: false, reason: "pending_preserved" };
  }

  const { error } = await supabase.from("referral_pending").insert({
    phone: normalized,
    referral_code: normalizedCode,
    created_at: new Date().toISOString(),
  });

  if (error) {
    if (error.code === "23505") {
      return { stashed: false, reason: "pending_preserved" };
    }
    console.error("[referrals] error al guardar pending:", error);
    throw error;
  }

  return { stashed: true, reason: "stashed" };
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
 * Captura código desde mensaje WhatsApp (stash first-write-wins + auditoría).
 */
export async function captureReferralCodeFromInbound(
  phone: string,
  text: string | null,
): Promise<string | null> {
  const { extractReferralCodeFromText } = await import("@/lib/referrals/codes");
  const code = extractReferralCodeFromText(text);
  if (!code) return null;

  const driver = await findDriverByReferralCode(code);
  const stash = await stashPendingReferralCode(phone, code);

  await recordReferralEvent({
    eventType: "link_shared",
    referralCode: code,
    referrerDriverId: driver?.id ?? null,
    meta: {
      phone: normalizePhone(phone),
      source: "whatsapp_inbound",
      stash: stash.reason,
    },
  }).catch((err) => {
    console.error("[referrals] evento link_shared:", err);
  });

  return code;
}

/** Primera conversión (viaje completado) del pasajero referido. */
export async function recordReferralConversionIfFirstCompletedTrip(
  passengerId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const { data: passenger, error } = await supabase
    .from("passengers")
    .select("id, referred_by_driver_id")
    .eq("id", passengerId)
    .maybeSingle();

  if (error) {
    console.error("[referrals] conversion passenger read:", error);
    return false;
  }
  if (!passenger?.referred_by_driver_id) return false;

  const { data: existing } = await supabase
    .from("referral_events")
    .select("id")
    .eq("passenger_id", passengerId)
    .eq("event_type", "conversion")
    .maybeSingle();

  if (existing) return false;

  const { data: attr } = await supabase
    .from("referral_attributions")
    .select("referral_code, referrer_driver_id")
    .eq("passenger_id", passengerId)
    .maybeSingle();

  const code = attr?.referral_code
    ? normalizeReferralCode(String(attr.referral_code))
    : "UNKNOWN";

  await recordReferralEvent({
    eventType: "conversion",
    referralCode: code,
    referrerDriverId:
      attr?.referrer_driver_id ?? passenger.referred_by_driver_id,
    passengerId,
    meta: { reason: "first_completed_trip" },
  });

  console.log("[referrals] conversión registrada", { passengerId, code });
  return true;
}

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

  const [{ count: attributions }, { count: clicks }] = await Promise.all([
    supabase
      .from("referral_attributions")
      .select("id", { count: "exact", head: true })
      .eq("referrer_driver_id", driverId),
    code
      ? supabase
          .from("referral_events")
          .select("id", { count: "exact", head: true })
          .eq("referral_code", code)
          .eq("event_type", "link_opened")
      : Promise.resolve({ count: 0 }),
  ]);

  return {
    driverId,
    referralCode: code,
    referralLink: code ? buildReferralLink(code) : null,
    totalReferrals: attributions ?? 0,
    totalClicks: clicks ?? 0,
  };
}

export async function getOpsReferralProgramStats(): Promise<OpsReferralProgramStats> {
  const supabase = getSupabase();

  const [clicks, registrations, attributed, conversions] = await Promise.all([
    supabase
      .from("referral_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "link_opened"),
    supabase
      .from("referral_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "passenger_registered"),
    supabase
      .from("referral_attributions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("referral_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "conversion"),
  ]);

  const totalClicks = clicks.count ?? 0;
  const totalRegistrations = registrations.count ?? 0;
  const totalAttributed = attributed.count ?? 0;
  const totalConversions = conversions.count ?? 0;

  return {
    totalClicks,
    totalRegistrations,
    totalAttributed,
    totalConversions,
    conversionPercent: computeReferralConversionPercent(
      totalAttributed,
      totalClicks,
    ),
  };
}

export type OpsReferralLeaderRow = {
  driverId: string;
  driverName: string;
  referralCode: string | null;
  attributions: number;
  clicks: number;
};

export async function listOpsReferralLeaders(
  limit = 30,
): Promise<OpsReferralLeaderRow[]> {
  const supabase = getSupabase();
  const { data: attrs, error } = await supabase
    .from("referral_attributions")
    .select("referrer_driver_id, referral_code");

  if (error) {
    console.error("[referrals] leaders:", error);
    throw error;
  }

  const byDriver = new Map<
    string,
    { code: string | null; attributions: number }
  >();
  for (const row of attrs ?? []) {
    const id = String(row.referrer_driver_id);
    const cur = byDriver.get(id) ?? { code: null, attributions: 0 };
    cur.attributions += 1;
    if (!cur.code && row.referral_code) {
      cur.code = normalizeReferralCode(String(row.referral_code));
    }
    byDriver.set(id, cur);
  }

  const driverIds = [...byDriver.keys()];
  if (driverIds.length === 0) return [];

  const { data: drivers } = await supabase
    .from("drivers")
    .select("id, full_name, preferred_name, name, referral_code")
    .in("id", driverIds);

  const nameById = new Map<string, string>();
  const codeById = new Map<string, string | null>();
  for (const d of drivers ?? []) {
    const label =
      d.preferred_name?.trim() ||
      d.full_name?.trim() ||
      d.name?.trim() ||
      "Conductor";
    nameById.set(d.id, label);
    codeById.set(
      d.id,
      d.referral_code
        ? normalizeReferralCode(String(d.referral_code))
        : byDriver.get(d.id)?.code ?? null,
    );
  }

  const rows: OpsReferralLeaderRow[] = [];
  for (const [driverId, stats] of byDriver) {
    const code = codeById.get(driverId) ?? stats.code;
    let clicks = 0;
    if (code) {
      const { count } = await supabase
        .from("referral_events")
        .select("id", { count: "exact", head: true })
        .eq("referral_code", code)
        .eq("event_type", "link_opened");
      clicks = count ?? 0;
    }
    rows.push({
      driverId,
      driverName: nameById.get(driverId) ?? "Conductor",
      referralCode: code,
      attributions: stats.attributions,
      clicks,
    });
  }

  rows.sort((a, b) => b.attributions - a.attributions);
  return rows.slice(0, limit);
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
