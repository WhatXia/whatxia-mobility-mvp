/**
 * PIONEERS-004 — Lanzamiento oficial de ciudad (WhatsApp CMS + auditoría).
 * Invocado únicamente desde closeLaunchProgram (manual = automático).
 */

import { getSupabase } from "@/lib/supabase/client";
import { getActiveCity } from "@/lib/city/context";
import { catalogBody, catalogButtons, catalogEntry } from "@/lib/bot-cms/copy";
import { resolvePublishedMessage } from "@/lib/bot-cms/resolve";
import type { CloseLaunchSource } from "@/lib/launch-programs/types";

export const CITY_LAUNCH_MESSAGE_CODE = "CITY_LAUNCH_MESSAGE";
const SOLICITAR_SERVICIO_ID = "solicitar_servicio";
const SOLICITAR_SERVICIO_TITLE = "🚖 Solicitar servicio";

export type CityLaunchAudit = {
  id: string;
  programId: string;
  cityId: string | null;
  cityName: string;
  status: "in_progress" | "completed" | "partial" | "failed" | "skipped";
  triggerSource: CloseLaunchSource;
  actorLabel: string;
  actorEmail: string | null;
  usersActivated: number;
  messagesSent: number;
  messagesFailed: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  cmsMessageCode: string;
  error: string | null;
};

export type PioneerRecipient = {
  id: string;
  phone: string;
  preferred_name: string | null;
  full_name: string | null;
  name: string | null;
};

function displayName(r: PioneerRecipient): string {
  return (
    r.preferred_name?.trim() ||
    r.full_name?.trim() ||
    r.name?.trim() ||
    "Pionero"
  );
}

function actorLabelFor(
  source: CloseLaunchSource,
  actorEmail?: string | null,
): string {
  if (source === "auto_end") return "SYSTEM";
  return actorEmail?.trim() || "SYSTEM";
}

function mapAudit(row: Record<string, unknown>): CityLaunchAudit {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    cityId: row.city_id == null ? null : String(row.city_id),
    cityName: String(row.city_name ?? ""),
    status: row.status as CityLaunchAudit["status"],
    triggerSource: row.trigger_source as CloseLaunchSource,
    actorLabel: String(row.actor_label ?? "SYSTEM"),
    actorEmail:
      typeof row.actor_email === "string" ? row.actor_email : null,
    usersActivated: Number(row.users_activated ?? 0),
    messagesSent: Number(row.messages_sent ?? 0),
    messagesFailed: Number(row.messages_failed ?? 0),
    durationMs:
      row.duration_ms == null ? null : Number(row.duration_ms),
    startedAt: String(row.started_at),
    finishedAt:
      row.finished_at == null ? null : String(row.finished_at),
    cmsMessageCode: String(row.cms_message_code ?? CITY_LAUNCH_MESSAGE_CODE),
    error: typeof row.error === "string" ? row.error : null,
  };
}

export async function getCityLaunchForProgram(
  programId: string,
): Promise<CityLaunchAudit | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("launch_program_city_launches")
    .select("*")
    .eq("program_id", programId)
    .maybeSingle();

  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("does not exist")
    ) {
      return null;
    }
    console.error("[city-launch] read:", error);
    throw error;
  }
  return data ? mapAudit(data as Record<string, unknown>) : null;
}

export async function getLatestCityLaunch(
  programCode?: string,
): Promise<CityLaunchAudit | null> {
  const supabase = getSupabase();

  if (programCode) {
    const { data: program, error: pErr } = await supabase
      .from("launch_programs")
      .select("id")
      .eq("code", programCode)
      .maybeSingle();
    if (pErr || !program?.id) {
      if (pErr?.code === "42P01") return null;
      return null;
    }
    const { data, error } = await supabase
      .from("launch_program_city_launches")
      .select("*")
      .eq("program_id", program.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (error.code === "42P01") return null;
      console.error("[city-launch] latest:", error);
      return null;
    }
    return data ? mapAudit(data as Record<string, unknown>) : null;
  }

  const { data, error } = await supabase
    .from("launch_program_city_launches")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") return null;
    console.error("[city-launch] latest:", error);
    return null;
  }
  return data ? mapAudit(data as Record<string, unknown>) : null;
}

export async function listPioneerRecipients(): Promise<PioneerRecipient[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("passengers")
    .select("id, phone, preferred_name, full_name, name")
    .eq("status", "PIONEER");

  if (error) {
    console.error("[city-launch] list pioneers:", error);
    throw error;
  }
  return (data ?? []) as PioneerRecipient[];
}

/** Recuperación: destinatarios de la última activación (cierre legacy sin CITY_LAUNCH). */
export async function listRecipientsFromLastActivation(
  programId: string,
): Promise<PioneerRecipient[]> {
  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase
    .from("launch_program_activation_runs")
    .select("id")
    .eq("program_id", programId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runErr || !run?.id) return [];

  const { data: rows, error } = await supabase
    .from("launch_program_outbound_messages")
    .select("passenger_id, phone")
    .eq("activation_run_id", run.id);

  if (error || !rows?.length) return [];

  const phones = Array.from(
    new Set(rows.map((r) => String(r.phone)).filter(Boolean)),
  );
  if (phones.length === 0) return [];

  const { data: passengers } = await supabase
    .from("passengers")
    .select("id, phone, preferred_name, full_name, name")
    .in("phone", phones);

  return (passengers ?? []) as PioneerRecipient[];
}

/** Omite cola legacy activation_message (el lanzamiento usa CITY_LAUNCH_MESSAGE). */
export async function skipLegacyActivationOutbound(
  activationRunId: string | null,
): Promise<void> {
  if (!activationRunId) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("launch_program_outbound_messages")
    .update({
      status: "skipped",
      error: "replaced_by_CITY_LAUNCH_MESSAGE",
    })
    .eq("activation_run_id", activationRunId)
    .eq("status", "pending");

  if (error) {
    console.warn("[city-launch] skip legacy outbound:", error.message);
  }
}

async function resolveCityLaunchMessage(vars: {
  nombre: string;
  ciudad: string;
}) {
  const fallbackBody = catalogBody(CITY_LAUNCH_MESSAGE_CODE);
  const catalogBtns = catalogButtons(CITY_LAUNCH_MESSAGE_CODE);
  const resolved = await resolvePublishedMessage(
    CITY_LAUNCH_MESSAGE_CODE,
    fallbackBody ||
      "🚀 ¡{{nombre}}, WhatXia ya está activo en {{ciudad}}!\n\nYa puedes solicitar tu primer servicio.",
    vars,
  );

  // PIONEERS-004: único botón permitido.
  const fromCms = resolved.buttons.find(
    (b) => b.id === SOLICITAR_SERVICIO_ID || b.id.includes("solicitar"),
  );
  const fromCatalog = catalogBtns.find((b) => b.id === SOLICITAR_SERVICIO_ID);
  const button = {
    id: SOLICITAR_SERVICIO_ID,
    title: (
      fromCms?.title ||
      fromCatalog?.title ||
      SOLICITAR_SERVICIO_TITLE
    ).slice(0, 20),
  };

  // Si el CMS no publicó botones, usar catálogo / default.
  if (!resolved.fromCms && catalogEntry(CITY_LAUNCH_MESSAGE_CODE)) {
    // ok
  }

  return {
    body: resolved.body,
    button,
    headerImage: resolved.headerImage,
  };
}

async function sendCityLaunchToRecipient(
  recipient: PioneerRecipient,
  cityName: string,
): Promise<{ ok: boolean; error?: string }> {
  const { sendButtonsMessage, sendTextMessage } = await import(
    "@/lib/whatsapp/client"
  );
  const nombre = displayName(recipient);
  const msg = await resolveCityLaunchMessage({
    nombre,
    ciudad: cityName,
  });

  try {
    if (msg.headerImage || msg.button) {
      await sendButtonsMessage(recipient.phone, msg.body, [msg.button], {
        headerImage: msg.headerImage ?? undefined,
      });
    } else {
      await sendTextMessage(recipient.phone, msg.body);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "send_failed",
    };
  }
}

/**
 * Reserva fila de auditoría (idempotencia). null → ya existe lanzamiento.
 */
export async function beginCityLaunchAudit(input: {
  programId: string;
  cityId: string | null;
  cityName: string;
  source: CloseLaunchSource;
  actorEmail?: string | null;
  actorId?: string | null;
  activationRunId?: string | null;
  usersActivated: number;
}): Promise<CityLaunchAudit | null> {
  const supabase = getSupabase();
  const label = actorLabelFor(input.source, input.actorEmail);

  const { data, error } = await supabase
    .from("launch_program_city_launches")
    .insert({
      program_id: input.programId,
      city_id: input.cityId,
      city_name: input.cityName,
      status: "in_progress",
      trigger_source: input.source,
      actor_label: label,
      actor_email: input.actorEmail ?? null,
      actor_id: input.actorId ?? null,
      activation_run_id: input.activationRunId ?? null,
      users_activated: input.usersActivated,
      cms_message_code: CITY_LAUNCH_MESSAGE_CODE,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .maybeSingle();

  if (error) {
    // unique violation → ya lanzado
    if (error.code === "23505") {
      return null;
    }
    console.error("[city-launch] begin audit:", error);
    throw error;
  }

  return data ? mapAudit(data as Record<string, unknown>) : null;
}

export async function finishCityLaunchAudit(
  launchId: string,
  patch: {
    status: CityLaunchAudit["status"];
    messagesSent: number;
    messagesFailed: number;
    durationMs: number;
    error?: string | null;
  },
): Promise<CityLaunchAudit> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("launch_program_city_launches")
    .update({
      status: patch.status,
      messages_sent: patch.messagesSent,
      messages_failed: patch.messagesFailed,
      duration_ms: patch.durationMs,
      finished_at: new Date().toISOString(),
      error: patch.error ?? null,
    })
    .eq("id", launchId)
    .select("*")
    .single();

  if (error) {
    console.error("[city-launch] finish audit:", error);
    throw error;
  }
  return mapAudit(data as Record<string, unknown>);
}

/**
 * Envía CITY_LAUNCH_MESSAGE a destinatarios y completa auditoría.
 */
export async function executeCityLaunchMessaging(input: {
  auditId: string;
  recipients: PioneerRecipient[];
  cityName: string;
  startedAtMs: number;
}): Promise<CityLaunchAudit> {
  let sent = 0;
  let failed = 0;

  for (const recipient of input.recipients) {
    const result = await sendCityLaunchToRecipient(
      recipient,
      input.cityName,
    );
    if (result.ok) sent += 1;
    else failed += 1;
  }

  const durationMs = Date.now() - input.startedAtMs;
  const status =
    failed === 0
      ? "completed"
      : sent === 0
        ? "failed"
        : "partial";

  return finishCityLaunchAudit(input.auditId, {
    status,
    messagesSent: sent,
    messagesFailed: failed,
    durationMs,
    error: failed > 0 ? `${failed} mensajes fallidos` : null,
  });
}

export async function runCityLaunchAfterActivation(input: {
  programId: string;
  source: CloseLaunchSource;
  actorEmail?: string | null;
  actorId?: string | null;
  activationRunId: string | null;
  recipients: PioneerRecipient[];
  usersActivated: number;
}): Promise<{ audit: CityLaunchAudit | null; skippedIdempotent: boolean }> {
  const startedAtMs = Date.now();
  const city = await getActiveCity();

  await skipLegacyActivationOutbound(input.activationRunId);

  const audit = await beginCityLaunchAudit({
    programId: input.programId,
    cityId: city.id,
    cityName: city.name,
    source: input.source,
    actorEmail: input.actorEmail,
    actorId: input.actorId,
    activationRunId: input.activationRunId,
    usersActivated: input.usersActivated,
  });

  // null = unique conflict → lanzamiento ya ejecutado (idempotencia).
  if (!audit) {
    console.log("[city-launch] ya ejecutado; skip WhatsApp/auditoría", {
      programId: input.programId,
    });
    return {
      audit: await getCityLaunchForProgram(input.programId),
      skippedIdempotent: true,
    };
  }

  const finished = await executeCityLaunchMessaging({
    auditId: audit.id,
    recipients: input.recipients,
    cityName: city.name,
    startedAtMs,
  });

  console.log("[city-launch] lanzamiento ciudad OK", {
    programId: input.programId,
    city: city.name,
    usersActivated: input.usersActivated,
    sent: finished.messagesSent,
    failed: finished.messagesFailed,
    durationMs: finished.durationMs,
    actor: finished.actorLabel,
  });

  return { audit: finished, skippedIdempotent: false };
}
