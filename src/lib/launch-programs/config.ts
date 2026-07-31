/**
 * CFG-001 / BOT-001 — Runtime de programas de lanzamiento (solo lectura + auto-fin).
 * Sin fechas/cupos/estados hardcodeados: todo viene de `launch_programs`.
 * No usa PRE_LAUNCH_MODE: el panel (is_active) es la fuente de verdad.
 */

import { getSupabase } from "@/lib/supabase/client";
import { cms, cmsSync } from "@/lib/bot-cms/copy";
import {
  computeAcceptsNewPioneers,
  statusForNewPassenger,
} from "@/lib/launch-programs/decision";

export const PIONEERS_USERS_CODE = "PIONEERS_USERS";

export type LaunchProgramRuntime = {
  id: string;
  code: string;
  isActiveFlag: boolean;
  /** true si el programa acepta nuevos PIONEER ahora */
  acceptsNewPioneers: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxQuota: number | null;
  autoActivateOnEnd: boolean;
  welcomeMessage: string | null;
  activationMessage: string | null;
  registeredPioneers: number;
};

type CacheEntry = {
  at: number;
  value: LaunchProgramRuntime | null;
};

/** Cache solo para mensajes/plantillas; la asignación de status siempre relee DB. */
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry>();

export function invalidateLaunchProgramCache(code?: string) {
  if (code) cache.delete(code);
  else cache.clear();
}

function renderTemplate(
  template: string,
  preferredName?: string | null,
): string {
  const name = preferredName?.trim() || "Pionero";
  return template
    .replaceAll("{{nombre}}", name)
    .replaceAll("{{Nombre}}", name)
    .replaceAll("{{name}}", name);
}

async function countPioneers(): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("passengers")
    .select("id", { count: "exact", head: true })
    .eq("status", "PIONEER");
  if (error) {
    console.error("[launch-programs] count pioneers:", error);
    return 0;
  }
  return count ?? 0;
}

async function deactivateProgram(
  programId: string,
  source: "auto_end" | "api" = "auto_end",
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc("deactivate_launch_program", {
    p_program_id: programId,
    p_trigger_source: source,
    p_actor_email: null,
    p_actor_id: null,
  });
  if (error) {
    console.error("[launch-programs] auto deactivate:", error);
    throw error;
  }
  invalidateLaunchProgramCache();
}

/**
 * Config vigente del programa. Si la tabla no existe o no hay fila → inactivo
 * (nuevos usuarios = ACTIVE). Sin fallback a PRE_LAUNCH_MODE.
 *
 * @param bypassCache — obligatorio en asignación de status (BOT-001) para
 *   respetar de inmediato el toggle del panel.
 */
export async function getLaunchProgramRuntime(
  code: string = PIONEERS_USERS_CODE,
  options?: { bypassCache?: boolean },
): Promise<LaunchProgramRuntime | null> {
  const bypassCache = Boolean(options?.bypassCache);
  if (!bypassCache) {
    const cached = cache.get(code);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("launch_programs")
    .select(
      "id, code, is_active, starts_at, ends_at, max_quota, auto_activate_on_end, welcome_message, activation_message",
    )
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error("[launch-programs] read error (tratado como inactivo):", error);
    cache.set(code, { at: Date.now(), value: null });
    return null;
  }

  if (!data) {
    cache.set(code, { at: Date.now(), value: null });
    return null;
  }

  const now = Date.now();
  let isActiveFlag = Boolean(data.is_active);

  if (
    isActiveFlag &&
    data.ends_at &&
    now > new Date(data.ends_at).getTime() &&
    data.auto_activate_on_end
  ) {
    try {
      await deactivateProgram(String(data.id), "auto_end");
      isActiveFlag = false;
    } catch {
      // Si falla RPC, no aceptar nuevos pioneros.
      isActiveFlag = false;
    }
  }

  const registeredPioneers = await countPioneers();
  const acceptsNewPioneers = computeAcceptsNewPioneers({
    isActive: isActiveFlag,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    maxQuota: data.max_quota == null ? null : Number(data.max_quota),
    registeredPioneers,
    nowMs: now,
  });

  const runtime: LaunchProgramRuntime = {
    id: String(data.id),
    code: String(data.code),
    isActiveFlag,
    acceptsNewPioneers,
    startsAt: data.starts_at ?? null,
    endsAt: data.ends_at ?? null,
    maxQuota: data.max_quota == null ? null : Number(data.max_quota),
    autoActivateOnEnd: Boolean(data.auto_activate_on_end),
    welcomeMessage: data.welcome_message ?? null,
    activationMessage: data.activation_message ?? null,
    registeredPioneers,
  };

  cache.set(code, { at: Date.now(), value: runtime });
  return runtime;
}

/** Lectura fresca de DB — usada en gate y en creación de pasajeros (BOT-001). */
export async function isPioneersProgramAccepting(): Promise<boolean> {
  const runtime = await getLaunchProgramRuntime(PIONEERS_USERS_CODE, {
    bypassCache: true,
  });
  return Boolean(runtime?.acceptsNewPioneers);
}

/** @deprecated nombre legacy; usa isPioneersProgramAccepting */
export async function isPreLaunchMode(): Promise<boolean> {
  return isPioneersProgramAccepting();
}

export async function defaultStatusForNewPassenger(): Promise<
  "PIONEER" | "ACTIVE"
> {
  const accepting = await isPioneersProgramAccepting();
  const status = statusForNewPassenger(accepting);
  console.log("[launch-programs] status inicial nuevo pasajero", {
    code: PIONEERS_USERS_CODE,
    accepting,
    status,
    // Diagnóstico: no debe influir (BOT-001).
    deprecatedEnvPreLaunch: process.env.PRE_LAUNCH_MODE ?? "(unset)",
  });
  return status;
}

export async function pioneerWelcomeMessage(
  preferredName?: string | null,
): Promise<string> {
  const runtime = await getLaunchProgramRuntime(PIONEERS_USERS_CODE);
  const template = runtime?.welcomeMessage?.trim();
  if (template) {
    return renderTemplate(template, preferredName);
  }
  // Sin mensaje en DB: fallback del catálogo (ops debe completar welcome_message).
  const name = preferredName?.trim() || "Pionero";
  return cmsSync("P_PIONEER_WELCOME_FALLBACK", { nombre: name });
}

export async function accessDeniedMessage(
  status: string | null | undefined,
  preferredName?: string | null,
): Promise<string> {
  if (status === "BLOCKED") {
    return cms("P_ACCESS_BLOCKED");
  }
  if (status === "PIONEER") {
    return pioneerWelcomeMessage(preferredName);
  }
  return cms("P_ACCESS_DENIED_GENERIC");
}

/** Drena cola de activación masiva (CFG-001). */
export async function drainLaunchOutboundQueue(limit = 15): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("launch_program_outbound_messages")
    .select("id, phone, body")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("does not exist")
    ) {
      return 0;
    }
    console.error("[launch-programs] outbound read:", error);
    return 0;
  }

  if (!data?.length) return 0;

  const { sendTextMessage } = await import("@/lib/whatsapp/client");
  let sent = 0;

  for (const row of data) {
    try {
      await sendTextMessage(String(row.phone), String(row.body));
      await supabase
        .from("launch_program_outbound_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", row.id);
      sent += 1;
    } catch (err) {
      await supabase
        .from("launch_program_outbound_messages")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : "send_failed",
        })
        .eq("id", row.id);
      console.error("[launch-programs] outbound send:", err);
    }
  }

  return sent;
}
