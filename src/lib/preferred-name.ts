/**
 * Nombre preferido del usuario (pasajero).
 * WhatsApp name se guarda como referencia; las conversaciones usan preferred_name.
 */

import type { IncomingMessage, UserSession } from "@/types";
import {
  findOrCreatePassenger,
  getPassengerDisplayName,
  hasPreferredName,
  setPassengerPreferredName,
  type PassengerRow,
} from "@/lib/supabase/passengers";
import { clearSession, getSession, upsertSession } from "@/lib/sessions";
import { sendTextMessage } from "@/lib/whatsapp/client";

export const PREFERRED_NAME_PROMPT = [
  "👋 ¡Hola! Bienvenido a WhatXia.",
  "",
  "Antes de comenzar...",
  "",
  "¿Cómo prefieres que te llamemos?",
].join("\n");

export function isWaitingPreferredName(
  session: UserSession | undefined,
): boolean {
  return session?.state === "WAITING_PREFERRED_NAME";
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

/**
 * Asegura pasajero + whatsapp_name actualizado.
 * @returns pasajero con preferred_name, o null si se pidió el nombre (flujo bloqueado).
 */
export async function ensurePreferredNameOrPrompt(
  phone: string,
  whatsappName: string,
): Promise<PassengerRow | null> {
  const passenger = await findOrCreatePassenger(phone, whatsappName);

  if (hasPreferredName(passenger)) {
    return passenger;
  }

  await promptForPreferredName(phone);
  return null;
}

export async function continuePreferredNameFlow(
  message: IncomingMessage,
): Promise<boolean> {
  const session = await getSession(message.phone);
  if (!isWaitingPreferredName(session)) {
    return false;
  }

  const raw = message.text?.trim() ?? "";
  if (!raw) {
    await sendTextMessage(
      message.phone,
      "Escribe el nombre con el que prefieres que te llamemos.",
    );
    return true;
  }

  // Evitar guardar saludos/intenciones como nombre.
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (
    ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches"].includes(
      normalized,
    )
  ) {
    await sendTextMessage(
      message.phone,
      "¿Cómo prefieres que te llamemos? Escribe solo tu nombre (ej. Carlos).",
    );
    return true;
  }

  const preferred = raw.slice(0, 40);
  const updated = await setPassengerPreferredName(message.phone, preferred);
  await clearSession(message.phone);

  const display = updated
    ? getPassengerDisplayName(updated)
    : preferred;

  await upsertSession(message.phone, {
    name: display,
    state: "IDLE",
    bookingDraft: null,
  });

  const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
  await sendPassengerActionMenu(message.phone, display, {
    body: `¡Perfecto, ${display}! 👋\n\n¿Qué deseas hacer?`,
  });

  console.log("[preferred-name] guardado", {
    phone: message.phone,
    preferredName: display,
  });

  return true;
}
