import type { DriverRow } from "@/lib/supabase/drivers";
import { sendTextMessage } from "@/lib/whatsapp/client";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import {
  buildExpiredBlockMessage,
  buildReactivatedMessage,
  buildReminderMessage,
  EXPIRED_DOCS_MESSAGE,
  getExpiredDocuments,
  getReminderTargets,
  hasExpiredDocuments,
  todayDateOnly,
  type DocumentType,
  type ReminderDay,
} from "@/lib/driver-documents";
import { getSupabase } from "@/lib/supabase/client";

export async function listAllDrivers(): Promise<DriverRow[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase.from("drivers").select("*");

  if (error) {
    console.error("[docs] error al listar conductores:", error);
    throw error;
  }

  return (data ?? []) as DriverRow[];
}

export async function applyDocumentBlock(
  driverId: string,
  reason: string,
): Promise<DriverRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({
      documents_blocked: true,
      documents_blocked_reason: reason,
      status: "inactive",
      is_available: false,
    })
    .eq("id", driverId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[docs] error al bloquear conductor:", error);
    throw error;
  }

  return data as DriverRow | null;
}

export async function clearDocumentBlock(
  driverId: string,
): Promise<DriverRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({
      documents_blocked: false,
      documents_blocked_reason: null,
      status: "active",
      // No reactivar disponibilidad automáticamente.
      is_available: false,
    })
    .eq("id", driverId)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[docs] error al desbloquear conductor:", error);
    throw error;
  }

  return data as DriverRow | null;
}

/**
 * Sincroniza bloqueo/reactivación según fechas actuales.
 * Devuelve el conductor actualizado y si hubo cambio de bloqueo.
 */
export async function syncDriverDocumentStatus(
  driver: DriverRow,
  options?: { notifyPhone?: string },
): Promise<{
  driver: DriverRow;
  blockedNow: boolean;
  unblockedNow: boolean;
  expired: DocumentType[];
}> {
  const today = todayDateOnly();
  const expired = getExpiredDocuments(driver, today);
  const shouldBlock = expired.length > 0;

  if (shouldBlock && !driver.documents_blocked) {
    const reason = `Documentos vencidos: ${expired.join(", ")}`;
    const updated = await applyDocumentBlock(driver.id, reason);
    const next = updated ?? { ...driver, documents_blocked: true, status: "inactive" as const, is_available: false };

    if (options?.notifyPhone) {
      await sendExpiredDocumentsPrompt(
        options.notifyPhone,
        buildExpiredBlockMessage(expired),
      );
    }

    return {
      driver: next,
      blockedNow: true,
      unblockedNow: false,
      expired,
    };
  }

  if (shouldBlock && driver.documents_blocked) {
    // Ya bloqueado; asegurar is_available false y status inactive.
    if (driver.is_available || driver.status !== "inactive") {
      const updated = await applyDocumentBlock(
        driver.id,
        driver.documents_blocked_reason ??
          `Documentos vencidos: ${expired.join(", ")}`,
      );
      return {
        driver: updated ?? driver,
        blockedNow: false,
        unblockedNow: false,
        expired,
      };
    }

    return { driver, blockedNow: false, unblockedNow: false, expired };
  }

  if (!shouldBlock && driver.documents_blocked) {
    const updated = await clearDocumentBlock(driver.id);
    const next = updated ?? {
      ...driver,
      documents_blocked: false,
      status: "active" as const,
      is_available: false,
    };

    if (options?.notifyPhone) {
      await sendTextMessage(options.notifyPhone, buildReactivatedMessage());
    }

    return {
      driver: next,
      blockedNow: false,
      unblockedNow: true,
      expired: [],
    };
  }

  return { driver, blockedNow: false, unblockedNow: false, expired: [] };
}

export async function wasReminderSent(input: {
  driverId: string;
  documentType: DocumentType;
  daysBefore: ReminderDay;
  expiresOn: string;
}): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("document_reminders")
    .select("id")
    .eq("driver_id", input.driverId)
    .eq("document_type", input.documentType)
    .eq("days_before", input.daysBefore)
    .eq("expires_on", input.expiresOn)
    .maybeSingle();

  if (error) {
    console.error("[docs] error al consultar recordatorio:", error);
    throw error;
  }

  return Boolean(data);
}

export async function markReminderSent(input: {
  driverId: string;
  documentType: DocumentType;
  daysBefore: ReminderDay;
  expiresOn: string;
}): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("document_reminders").insert({
    driver_id: input.driverId,
    document_type: input.documentType,
    days_before: input.daysBefore,
    expires_on: input.expiresOn,
  });

  if (error) {
    // Duplicado: otro proceso ya lo envió.
    if (error.code === "23505") {
      return;
    }
    console.error("[docs] error al guardar recordatorio:", error);
    throw error;
  }
}

export async function runDailyDocumentJobs(): Promise<{
  blocked: number;
  reminders: number;
  date: string;
}> {
  const today = todayDateOnly();
  const drivers = await listAllDrivers();

  let blocked = 0;
  let reminders = 0;

  for (const driver of drivers) {
    const expired = getExpiredDocuments(driver, today);

    if (expired.length > 0) {
      const wasBlocked = driver.documents_blocked;
      await applyDocumentBlock(
        driver.id,
        `Documentos vencidos: ${expired.join(", ")}`,
      );
      blocked += 1;

      if (!wasBlocked) {
        await sendExpiredDocumentsPrompt(
          driver.phone,
          buildExpiredBlockMessage(expired),
        );
      }
      continue;
    }

    // Sin vencidos: si estaba bloqueado por docs, reactivar estado (no disponibilidad).
    if (driver.documents_blocked) {
      const cleared = await clearDocumentBlock(driver.id);
      if (cleared) {
        await sendTextMessage(driver.phone, buildReactivatedMessage());
      }
    }

    const targets = getReminderTargets(driver, today);

    for (const target of targets) {
      const alreadySent = await wasReminderSent({
        driverId: driver.id,
        documentType: target.type,
        daysBefore: target.daysBefore,
        expiresOn: target.expiresOn,
      });

      if (alreadySent) {
        continue;
      }

      await sendTextMessage(
        driver.phone,
        buildReminderMessage(
          driver.name,
          target.type,
          target.daysBefore,
          target.expiresOn,
        ),
      );

      await markReminderSent({
        driverId: driver.id,
        documentType: target.type,
        daysBefore: target.daysBefore,
        expiresOn: target.expiresOn,
      });

      reminders += 1;
    }
  }

  console.log("[docs:cron]", { date: today, blocked, reminders });

  return { blocked, reminders, date: today };
}

export { EXPIRED_DOCS_MESSAGE, hasExpiredDocuments };
