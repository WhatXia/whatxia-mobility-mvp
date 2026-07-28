/**
 * Auditoría de cambios de perfil de conductor (DRIVER-004).
 */

import { getSupabase } from "@/lib/supabase/client";

export type DriverProfileAuditInput = {
  driverId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  source?: string;
};

export async function recordDriverProfileAudit(
  input: DriverProfileAuditInput,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("driver_profile_audits").insert({
    driver_id: input.driverId,
    field_name: input.fieldName,
    old_value: input.oldValue,
    new_value: input.newValue,
    source: input.source ?? "WhatsApp",
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[driver-profile-audit] error al registrar:", error);
    // No bloquear la actualización operativa por fallo de auditoría.
  }
}

export function auditValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

/** Último cambio exitoso del campo phone (DRIVER-004.1). */
export async function getLastPhoneChangeAt(
  driverId: string,
): Promise<Date | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("driver_profile_audits")
    .select("created_at")
    .eq("driver_id", driverId)
    .eq("field_name", "phone")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[driver-profile-audit] error al leer último phone:", error);
    throw error;
  }

  if (!data?.created_at) {
    return null;
  }

  const parsed = new Date(String(data.created_at));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export const PHONE_CHANGE_COOLDOWN_DAYS = 30;

export type PhoneChangeCooldown =
  | { allowed: true }
  | { allowed: false; nextAvailableAt: Date };

/** Regla DRIVER-004.1: máximo un cambio de WhatsApp cada 30 días. */
export function evaluatePhoneChangeCooldown(
  lastChangeAt: Date | null,
  now: Date = new Date(),
): PhoneChangeCooldown {
  if (!lastChangeAt) {
    return { allowed: true };
  }

  const nextAvailableAt = new Date(lastChangeAt.getTime());
  nextAvailableAt.setUTCDate(
    nextAvailableAt.getUTCDate() + PHONE_CHANGE_COOLDOWN_DAYS,
  );

  if (now.getTime() >= nextAvailableAt.getTime()) {
    return { allowed: true };
  }

  return { allowed: false, nextAvailableAt };
}

/** Fecha legible en español (ej. 26/08/2026). */
export function formatPhoneChangeAvailableDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
