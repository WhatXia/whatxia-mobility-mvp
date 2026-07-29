/**
 * Captura de identidad (pasajeros y conductores nuevos):
 * 1) full_name (nombre y apellido exactos)
 * 2) preferred_name (cómo te llamamos)
 *
 * whatsapp_name se conserva como referencia.
 * Conversación → preferred_name. Identidad compartida P↔D → full_name.
 */

import type { IncomingMessage, UserSession } from "@/types";
import {
  findOrCreatePassenger,
  getPassengerDisplayName,
  hasCompleteIdentity,
  hasFullName,
  hasPreferredName,
  setPassengerFullName,
  setPassengerPreferredName,
  setPassengerRegistrationSource,
  type PassengerRow,
} from "@/lib/supabase/passengers";
import {
  accessDeniedMessage,
  canPassengerRequestService,
} from "@/lib/passenger-status";
import {
  parseRegistrationSourceChoice,
  REGISTRATION_SOURCE_PROMPT,
} from "@/lib/registration-source";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";
import { clearSession, getSession, upsertSession } from "@/lib/sessions";
import { sendTextMessage } from "@/lib/whatsapp/client";

export const FULL_NAME_PROMPT = [
  "👋 ¡Bienvenido a WhatXia!",
  "",
  "Antes de comenzar...",
  "",
  "¿Cuál es tu nombre y apellido?",
].join("\n");

export const PREFERRED_NAME_PROMPT = "¿Cómo prefieres que te llamemos?";

const GREETING_BLOCKLIST = new Set([
  "hola",
  "buenas",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
]);

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function isBlockedName(text: string): boolean {
  return GREETING_BLOCKLIST.has(normalizeText(text));
}

export function isWaitingIdentity(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "WAITING_FULL_NAME" ||
    session?.state === "WAITING_PREFERRED_NAME" ||
    session?.state === "WAITING_REGISTRATION_SOURCE"
  );
}

/** @deprecated usar isWaitingIdentity */
export function isWaitingPreferredName(
  session: UserSession | undefined,
): boolean {
  return isWaitingIdentity(session);
}

export async function promptForFullName(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "WAITING_FULL_NAME",
    bookingDraft: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
  });
  await sendTextMessage(phone, FULL_NAME_PROMPT);
}

export async function promptForPreferredName(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "WAITING_PREFERRED_NAME",
    bookingDraft: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
  });
  await sendTextMessage(phone, PREFERRED_NAME_PROMPT);
}

export async function promptForRegistrationSource(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "WAITING_REGISTRATION_SOURCE",
    bookingDraft: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
  });
  await sendTextMessage(phone, REGISTRATION_SOURCE_PROMPT);
}

async function finishIdentityOnboarding(
  phone: string,
  passenger: PassengerRow,
  display: string,
): Promise<void> {
  await clearSession(phone);
  await upsertSession(phone, {
    name: display,
    state: "IDLE",
    bookingDraft: null,
  });

  if (!canPassengerRequestService(passenger.status)) {
    await sendTextMessage(phone, accessDeniedMessage(passenger.status));
  } else {
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(phone, display);
  }
}

/** Sincroniza identidad al perfil conductor si existe (mismo WhatsApp). */
async function syncIdentityToDriver(
  phone: string,
  fullName: string | null,
  preferredName: string | null,
): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) return;

  const patch: Record<string, string> = {};
  if (fullName?.trim()) {
    patch.full_name = fullName.trim();
  }
  if (preferredName?.trim()) {
    patch.preferred_name = preferredName.trim();
  }
  if (Object.keys(patch).length === 0) return;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("drivers")
    .update(patch)
    .eq("id", driver.id);

  if (error) {
    console.error("[identity] error al sincronizar conductor:", error);
    throw error;
  }
}

/**
 * @returns pasajero con identidad completa, o null si el flujo quedó bloqueado pidiendo datos.
 */
export async function ensureIdentityOrPrompt(
  phone: string,
  whatsappName: string,
): Promise<PassengerRow | null> {
  const passenger = await findOrCreatePassenger(phone, whatsappName);

  if (hasCompleteIdentity(passenger)) {
    return passenger;
  }

  if (!hasFullName(passenger)) {
    await promptForFullName(phone);
    return null;
  }

  if (!hasPreferredName(passenger)) {
    await promptForPreferredName(phone);
    return null;
  }

  return passenger;
}

/** Alias Sprint 2.2 */
export async function ensurePreferredNameOrPrompt(
  phone: string,
  whatsappName: string,
): Promise<PassengerRow | null> {
  return ensureIdentityOrPrompt(phone, whatsappName);
}

export async function continuePreferredNameFlow(
  message: IncomingMessage,
): Promise<boolean> {
  const session = await getSession(message.phone);
  if (!isWaitingIdentity(session)) {
    return false;
  }

  const raw = message.text?.trim() ?? "";

  if (session?.state === "WAITING_FULL_NAME") {
    if (!raw) {
      await sendTextMessage(
        message.phone,
        "Escribe tu nombre y apellido (ej. Carlos Fernando Valencia).",
      );
      return true;
    }
    if (isBlockedName(raw)) {
      await sendTextMessage(
        message.phone,
        "¿Cuál es tu nombre y apellido? Escríbelos tal como quieres que aparezcan.",
      );
      return true;
    }

    const fullName = raw.slice(0, 80);
    const updated = await setPassengerFullName(message.phone, fullName);
    await syncIdentityToDriver(
      message.phone,
      fullName,
      updated?.preferred_name ?? null,
    );

    await promptForPreferredName(message.phone);
    console.log("[identity] full_name guardado", {
      phone: message.phone,
      fullName,
    });
    return true;
  }

  // WAITING_PREFERRED_NAME
  if (session?.state === "WAITING_PREFERRED_NAME") {
    if (!raw) {
      await sendTextMessage(
        message.phone,
        "Escribe el nombre con el que prefieres que te llamemos (ej. Carlos).",
      );
      return true;
    }
    if (isBlockedName(raw)) {
      await sendTextMessage(
        message.phone,
        "¿Cómo prefieres que te llamemos? Escribe solo ese nombre (ej. Carlos).",
      );
      return true;
    }

    const preferred = raw.slice(0, 40);
    const updated = await setPassengerPreferredName(message.phone, preferred);
    const passenger = updated ?? (await findOrCreatePassenger(message.phone));
    await syncIdentityToDriver(
      message.phone,
      passenger.full_name,
      preferred,
    );

    await promptForRegistrationSource(message.phone);

    console.log("[identity] preferred_name guardado", {
      phone: normalizePhone(message.phone),
      preferredName: preferred,
      fullName: passenger.full_name,
    });

    return true;
  }

  if (session?.state === "WAITING_REGISTRATION_SOURCE") {
    if (!raw) {
      await sendTextMessage(message.phone, REGISTRATION_SOURCE_PROMPT);
      return true;
    }

    const source = parseRegistrationSourceChoice(raw);
    if (!source) {
      await sendTextMessage(
        message.phone,
        "Opción no válida. Responde con un número del 1 al 7.\n\n" +
          REGISTRATION_SOURCE_PROMPT,
      );
      return true;
    }

    const updated = await setPassengerRegistrationSource(
      message.phone,
      source,
    );
    const passenger =
      updated ?? (await findOrCreatePassenger(message.phone, message.name));
    const display = getPassengerDisplayName(passenger, message.name);

    await finishIdentityOnboarding(message.phone, passenger, display);

    console.log("[identity] registration_source guardado", {
      phone: normalizePhone(message.phone),
      source,
      status: passenger.status,
    });
    return true;
  }

  return true;
}
