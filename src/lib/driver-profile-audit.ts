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
