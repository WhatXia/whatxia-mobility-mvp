import type { IncomingMessage } from "@/types";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";

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
  await sendButtonsMessage(phone, "¡Hola! ¿Qué deseas hacer?", [
    { id: BUTTON_IDS.SOLICITAR_SERVICIO, title: "Solicitar servicio" },
    { id: BUTTON_IDS.CANCELAR, title: "❌ Cancelar" },
  ]);
}

export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  console.log("[whatsapp] mensaje recibido:", message);

  if (message.button === BUTTON_IDS.SOLICITAR_SERVICIO) {
    upsertSession(message.phone, {
      name: message.name,
      state: "WAITING_PICKUP",
      pickupNeighborhood: null,
    });

    await sendTextMessage(
      message.phone,
      "¿En qué barrio te vamos a recoger?",
    );
    return;
  }

  if (message.button === BUTTON_IDS.CANCELAR) {
    clearSession(message.phone);
    await sendTextMessage(message.phone, "Operación cancelada.");
    return;
  }

  const session = getSession(message.phone);

  if (session?.state === "WAITING_PICKUP" && message.text) {
    const neighborhood = message.text.trim();

    upsertSession(message.phone, {
      name: message.name,
      state: "SEARCHING_DRIVER",
      pickupNeighborhood: neighborhood,
    });

    console.log("[session] barrio guardado:", {
      phone: message.phone,
      pickupNeighborhood: neighborhood,
    });

    await sendTextMessage(
      message.phone,
      "Estamos buscando un conductor. Un momento por favor.",
    );
    return;
  }

  if (isGreeting(message.text)) {
    upsertSession(message.phone, {
      name: message.name,
      state: "IDLE",
      pickupNeighborhood: null,
    });
    await sendWelcomeMenu(message.phone);
    return;
  }

  if (message.text) {
    await sendTextMessage(message.phone, "Escribe Hola para comenzar.");
  }
}
