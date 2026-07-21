import type { IncomingMessage } from "@/types";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

/** IDs de botones — Fase 4 usará SOLICITAR_SERVICIO para pedir el barrio. */
export const BUTTON_IDS = {
  SOLICITAR_SERVICIO: "solicitar_servicio",
  CANCELAR: "cancelar",
} as const;

const GREETINGS = new Set(["hola", "buenas", "buenos dias"]);

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function isGreeting(text: string | null): boolean {
  if (!text) {
    return false;
  }

  return GREETINGS.has(normalizeText(text));
}

async function sendWelcomeMenu(phone: string) {
  // Títulos ≤ 20 caracteres (límite de WhatsApp Cloud API).
  // El emoji 🚖 + "Solicitar servicio" supera el límite, por eso va sin emoji.
  await sendButtonsMessage(phone, "¡Hola! ¿Qué deseas hacer?", [
    { id: BUTTON_IDS.SOLICITAR_SERVICIO, title: "Solicitar servicio" },
    { id: BUTTON_IDS.CANCELAR, title: "❌ Cancelar" },
  ]);
}

/**
 * Punto de entrada del bot.
 * Fase 4: al pulsar solicitar_servicio, pedir el barrio de recogida.
 */
export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  console.log("[whatsapp] mensaje recibido:", message);

  if (message.button === BUTTON_IDS.SOLICITAR_SERVICIO) {
    // Fase 4: pedir barrio de recogida.
    return;
  }

  if (message.button === BUTTON_IDS.CANCELAR) {
    await sendTextMessage(message.phone, "Operación cancelada.");
    return;
  }

  if (isGreeting(message.text)) {
    await sendWelcomeMenu(message.phone);
    return;
  }

  if (message.text) {
    await sendTextMessage(message.phone, "Escribe Hola para comenzar.");
  }
}
