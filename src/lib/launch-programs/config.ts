/**
 * CFG-001 / BOT-001 / BUG-PIONEERS-003 — Runtime de programas de lanzamiento.
 * Cierre único: `closeLaunchProgram` (manual y auto_end).
 */

import { getSupabase } from "@/lib/supabase/client";
import { cms, cmsSync } from "@/lib/bot-cms/copy";
import {
  computeAcceptsNewPioneers,
  statusForNewPassenger,
} from "@/lib/launch-programs/decision";
import {
  getCityLaunchForProgram,
  listPioneerRecipients,
  listRecipientsFromLastActivation,
  runCityLaunchAfterActivation,
  type CityLaunchAudit,
} from "@/lib/launch-programs/city-launch";
import type { CloseLaunchSource } from "@/lib/launch-programs/types";

export type { CloseLaunchSource } from "@/lib/launch-programs/types";

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

export type CloseLaunchProgramResult = {
  ok: boolean;
  alreadyInactive: boolean;
  alreadyLaunched: boolean;
  activatedCount: number;
  runId: string | null;
  queuedMessages: boolean;
  /** Mensajes CITY_LAUNCH_MESSAGE enviados (PIONEERS-004). */
  messagesSent: number;
  messagesFailed: number;
  programId: string;
  source: CloseLaunchSource;
  cityLaunch: CityLaunchAudit | null;
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

export async function drainLaunchOutboundQueueFully(
  maxBatches = 40,
  batchSize = 25,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxBatches; i += 1) {
    const n = await drainLaunchOutboundQueue(batchSize);
    total += n;
    if (n < batchSize) break;
  }
  return total;
}

function mapCloseRpcResult(
  programId: string,
  source: CloseLaunchSource,
  raw: unknown,
): Pick<
  CloseLaunchProgramResult,
  | "ok"
  | "alreadyInactive"
  | "activatedCount"
  | "runId"
  | "queuedMessages"
  | "programId"
  | "source"
> {
  const data =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ok: data.ok !== false,
    alreadyInactive: Boolean(data.already_inactive),
    activatedCount: Number(data.activated_count ?? 0),
    runId: data.run_id == null ? null : String(data.run_id),
    queuedMessages: Boolean(data.queued_messages),
    programId,
    source,
  };
}

/**
 * Única función de cierre + lanzamiento de ciudad (PIONEERS-004).
 * Manual (Desactivar) y auto (ends_at) llaman esto.
 *
 * 1) Idempotencia: si ya hay auditoría de lanzamiento → no reactivar / no reenviar.
 * 2) RPC deactivate: INACTIVE + PIONEER→ACTIVE.
 * 3) WhatsApp CITY_LAUNCH_MESSAGE (CMS) a activados.
 * 4) Auditoría completa.
 */
export async function closeLaunchProgram(
  programId: string,
  options?: {
    source?: CloseLaunchSource;
    actorEmail?: string | null;
    actorId?: string | null;
    /** @deprecated PIONEERS-004 usa CITY_LAUNCH_MESSAGE; se ignora el drain legacy */
    drainQueue?: boolean;
  },
): Promise<CloseLaunchProgramResult> {
  const source = options?.source ?? "manual";
  const supabase = getSupabase();

  const existingLaunch = await getCityLaunchForProgram(programId);
  if (existingLaunch && existingLaunch.status !== "in_progress") {
    // Asegurar programa inactivo sin reenviar.
    const { data: rpcData } = await supabase.rpc("deactivate_launch_program", {
      p_program_id: programId,
      p_trigger_source: source,
      p_actor_email: options?.actorEmail ?? null,
      p_actor_id: options?.actorId ?? null,
    });
    invalidateLaunchProgramCache();
    const base = mapCloseRpcResult(programId, source, rpcData);
    console.log("[launch-programs] closeLaunchProgram idempotent skip", {
      programId,
      launchId: existingLaunch.id,
    });
    return {
      ...base,
      alreadyLaunched: true,
      messagesSent: existingLaunch.messagesSent,
      messagesFailed: existingLaunch.messagesFailed,
      cityLaunch: existingLaunch,
    };
  }

  // Capturar pioneros ANTES del RPC (pasan a ACTIVE).
  const pioneers = await listPioneerRecipients();

  const { data, error } = await supabase.rpc("deactivate_launch_program", {
    p_program_id: programId,
    p_trigger_source: source,
    p_actor_email: options?.actorEmail ?? null,
    p_actor_id: options?.actorId ?? null,
  });

  if (error) {
    console.error("[launch-programs] closeLaunchProgram RPC:", error);
    throw error;
  }

  invalidateLaunchProgramCache();

  const base = mapCloseRpcResult(programId, source, data);
  let recipients = base.alreadyInactive ? [] : pioneers;
  let usersActivated = base.alreadyInactive
    ? 0
    : Math.max(base.activatedCount, pioneers.length);

  // Cierre legacy sin CITY_LAUNCH: recuperar destinatarios de la última activación.
  if (base.alreadyInactive && recipients.length === 0) {
    recipients = await listRecipientsFromLastActivation(programId);
    usersActivated = recipients.length;
  }

  let cityLaunch: CityLaunchAudit | null = null;
  let skippedIdempotent = false;
  try {
    const launchResult = await runCityLaunchAfterActivation({
      programId,
      source,
      actorEmail: options?.actorEmail,
      actorId: options?.actorId,
      activationRunId: base.runId,
      recipients,
      usersActivated,
    });
    cityLaunch = launchResult.audit;
    skippedIdempotent = launchResult.skippedIdempotent;
  } catch (err) {
    console.error("[launch-programs] city launch failed:", err);
    // El cierre/activación ya ocurrió; no revertir.
  }

  const result: CloseLaunchProgramResult = {
    ...base,
    alreadyLaunched: skippedIdempotent,
    messagesSent: cityLaunch?.messagesSent ?? 0,
    messagesFailed: cityLaunch?.messagesFailed ?? 0,
    cityLaunch,
  };

  console.log("[launch-programs] closeLaunchProgram", {
    programId,
    source,
    alreadyInactive: base.alreadyInactive,
    alreadyLaunched: result.alreadyLaunched,
    activatedCount: usersActivated,
    messagesSent: result.messagesSent,
    messagesFailed: result.messagesFailed,
    runId: base.runId,
    cityLaunchId: cityLaunch?.id ?? null,
  });

  return result;
}

/**
 * Worker: programas activos con now >= ends_at y auto_activate_on_end.
 * Cron + lazy en webhook. Sin esto, el auto-fin no dispara en producción.
 */
export async function processDueLaunchProgramClosures(): Promise<{
  scanned: number;
  closed: number;
  results: CloseLaunchProgramResult[];
}> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("launch_programs")
    .select("id, code, ends_at, is_active, auto_activate_on_end")
    .eq("is_active", true)
    .eq("auto_activate_on_end", true)
    .not("ends_at", "is", null)
    .lte("ends_at", nowIso);

  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("does not exist")
    ) {
      return { scanned: 0, closed: 0, results: [] };
    }
    console.error("[launch-programs] processDue read:", error);
    throw error;
  }

  const rows = data ?? [];
  const results: CloseLaunchProgramResult[] = [];
  let closed = 0;

  for (const row of rows) {
    try {
      const result = await closeLaunchProgram(String(row.id), {
        source: "auto_end",
        drainQueue: true,
      });
      results.push(result);
      if (!result.alreadyInactive) closed += 1;
    } catch (err) {
      console.error("[launch-programs] processDue close failed:", {
        programId: row.id,
        code: row.code,
        err,
      });
    }
  }

  if (rows.length > 0) {
    console.log("[launch-programs] processDueLaunchProgramClosures", {
      scanned: rows.length,
      closed,
      at: nowIso,
    });
  }

  return { scanned: rows.length, closed, results };
}

/**
 * Config vigente del programa. Si la tabla no existe o no hay fila → inactivo
 * (nuevos usuarios = ACTIVE). Sin fallback a PRE_LAUNCH_MODE.
 *
 * Side-effect controlado: si está vencido, llama `closeLaunchProgram` (misma
 * lógica que el botón Desactivar).
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

  // BUG-PIONEERS-003: now >= ends_at → misma función que desactivación manual.
  if (
    isActiveFlag &&
    data.ends_at &&
    now >= new Date(data.ends_at).getTime() &&
    data.auto_activate_on_end
  ) {
    try {
      await closeLaunchProgram(String(data.id), {
        source: "auto_end",
        drainQueue: true,
      });
      isActiveFlag = false;
    } catch (err) {
      console.error(
        "[launch-programs] auto close en getLaunchProgramRuntime falló:",
        err,
      );
      // No aceptar nuevos pioneros aunque el RPC falle.
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
