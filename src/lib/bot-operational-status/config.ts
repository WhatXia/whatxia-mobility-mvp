/**
 * SYS-001 — Estado operativo del bot (ACTIVE | MAINTENANCE).
 * Fuente de verdad: `bot_operational_status` (Ops escribe; bot lee).
 */

import { getSupabase } from "@/lib/supabase/client";
import { cms, cmsSync } from "@/lib/bot-cms/copy";
import { invalidateBotCmsCache } from "@/lib/bot-cms/resolve";
import { normalizePhone } from "@/lib/trips";
import {
  isBotOperationalStatus,
  type BotOperationalStatus,
  type BotOperationalStatusCode,
} from "@/lib/bot-operational-status/types";

export const DEFAULT_CMS_MESSAGE_CODE = "SYS_BOT_MAINTENANCE";

const DEFAULT_MESSAGE = cmsSync(DEFAULT_CMS_MESSAGE_CODE);

type CacheEntry = { at: number; value: BotOperationalStatus };
let cache: CacheEntry | null = null;
/** Cache corto: desactivar mantenimiento debe verse de inmediato. */
const CACHE_TTL_MS = 3_000;

export function invalidateBotOperationalStatusCache() {
  cache = null;
}

function defaultStatus(): BotOperationalStatus {
  return {
    status: "ACTIVE",
    maintenanceMessage: DEFAULT_MESSAGE,
    cmsMessageCode: DEFAULT_CMS_MESSAGE_CODE,
    updatedAt: null,
    updatedByEmail: null,
    updatedById: null,
  };
}

function mapRow(data: Record<string, unknown>): BotOperationalStatus {
  const status = isBotOperationalStatus(data.status) ? data.status : "ACTIVE";
  const message =
    typeof data.maintenance_message === "string" &&
    data.maintenance_message.trim()
      ? data.maintenance_message.trim()
      : DEFAULT_MESSAGE;
  const cmsCode =
    typeof data.cms_message_code === "string" && data.cms_message_code.trim()
      ? data.cms_message_code.trim().toUpperCase()
      : DEFAULT_CMS_MESSAGE_CODE;

  return {
    status,
    maintenanceMessage: message,
    cmsMessageCode: cmsCode,
    updatedAt:
      typeof data.updated_at === "string" ? data.updated_at : null,
    updatedByEmail:
      typeof data.updated_by_email === "string"
        ? data.updated_by_email
        : null,
    updatedById:
      typeof data.updated_by_id === "string" ? data.updated_by_id : null,
  };
}

/**
 * Estado vigente. Sin fila / error → ACTIVE (fail-open para no tumbar el bot).
 * @param bypassCache — true en el gate conversacional (SYS-001).
 */
export async function getBotOperationalStatus(
  options?: { bypassCache?: boolean },
): Promise<BotOperationalStatus> {
  if (!options?.bypassCache && cache) {
    if (Date.now() - cache.at < CACHE_TTL_MS) {
      return cache.value;
    }
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bot_operational_status")
      .select(
        "status, maintenance_message, cms_message_code, updated_at, updated_by_email, updated_by_id",
      )
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error(
        "[sys-001] read error (tratado como ACTIVE):",
        error.message,
      );
      const fallback = defaultStatus();
      cache = { at: Date.now(), value: fallback };
      return fallback;
    }

    if (!data) {
      const fallback = defaultStatus();
      cache = { at: Date.now(), value: fallback };
      return fallback;
    }

    const value = mapRow(data as Record<string, unknown>);
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[sys-001] exception (tratado como ACTIVE):", err);
    const fallback = defaultStatus();
    cache = { at: Date.now(), value: fallback };
    return fallback;
  }
}

export async function isBotInMaintenance(): Promise<boolean> {
  const status = await getBotOperationalStatus({ bypassCache: true });
  return status.status === "MAINTENANCE";
}

/**
 * Mensaje de mantenimiento (SYS-001):
 * - Ops edita `bot_operational_status.maintenance_message` y sincroniza CMS.
 * - Si el CMS publicó `SYS_BOT_MAINTENANCE`, también aplica (editable desde CMS).
 * - Fallback: catálogo en código.
 */
export async function resolveMaintenanceMessage(
  status?: BotOperationalStatus,
): Promise<string> {
  const current =
    status ?? (await getBotOperationalStatus({ bypassCache: true }));
  const fromOps = current.maintenanceMessage.trim();
  const fromCms = (await cms(current.cmsMessageCode)).trim();
  const catalogFallback = cmsSync(DEFAULT_CMS_MESSAGE_CODE).trim();

  // CMS publicado distinto al fallback → priorizar CMS (editable en panel CMS).
  if (fromCms && fromCms !== catalogFallback) {
    return fromCms;
  }
  if (fromOps) return fromOps;
  return fromCms || catalogFallback;
}

/** Números que pueden conversar aunque el bot esté en mantenimiento (admins). */
export function isMaintenanceBypassPhone(phone: string): boolean {
  const raw = process.env.BOT_MAINTENANCE_BYPASS_PHONES?.trim();
  if (!raw) return false;
  const normalized = normalizePhone(phone);
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizePhone(p))
    .filter(Boolean)
    .includes(normalized);
}

async function syncCmsMaintenanceMessage(body: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from("bot_messages")
      .update({
        body,
        status: "PUBLISHED",
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("code", DEFAULT_CMS_MESSAGE_CODE);

    if (error) {
      // Tabla ausente o esquema distinto: no bloquear el toggle Ops.
      console.warn("[sys-001] sync CMS message skipped:", error.message);
      return;
    }
    invalidateBotCmsCache();
  } catch (err) {
    console.warn("[sys-001] sync CMS message failed:", err);
  }
}

export async function updateBotOperationalStatus(input: {
  status: BotOperationalStatusCode;
  maintenanceMessage: string;
  actorEmail?: string | null;
  actorId?: string | null;
}): Promise<BotOperationalStatus> {
  const message = input.maintenanceMessage.trim() || DEFAULT_MESSAGE;
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("bot_operational_status")
    .upsert(
      {
        id: 1,
        status: input.status,
        maintenance_message: message,
        cms_message_code: DEFAULT_CMS_MESSAGE_CODE,
        updated_at: now,
        updated_by_email: input.actorEmail ?? null,
        updated_by_id: input.actorId ?? null,
      },
      { onConflict: "id" },
    )
    .select(
      "status, maintenance_message, cms_message_code, updated_at, updated_by_email, updated_by_id",
    )
    .single();

  if (error) {
    console.error("[sys-001] update error:", error);
    throw error;
  }

  await syncCmsMaintenanceMessage(message);
  invalidateBotOperationalStatusCache();

  const value = mapRow(data as Record<string, unknown>);
  cache = { at: Date.now(), value };

  console.log("[sys-001] estado actualizado", {
    status: value.status,
    by: value.updatedByEmail,
    at: value.updatedAt,
  });

  return value;
}

/**
 * Gate conversacional SYS-001.
 * @returns true si el handler debe terminar (mantenimiento respondido).
 */
export async function handleMaintenanceIfNeeded(
  phone: string,
): Promise<boolean> {
  if (isMaintenanceBypassPhone(phone)) {
    console.log("[sys-001] bypass admin", { phone });
    return false;
  }

  const status = await getBotOperationalStatus({ bypassCache: true });
  if (status.status !== "MAINTENANCE") {
    return false;
  }

  const { sendTextMessage } = await import("@/lib/whatsapp/client");
  const body = await resolveMaintenanceMessage(status);
  await sendTextMessage(phone, body);

  console.log("[sys-001] mantenimiento → mensaje único; fin flujos", {
    phone,
  });
  return true;
}
