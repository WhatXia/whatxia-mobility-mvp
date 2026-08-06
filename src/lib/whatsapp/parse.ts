/**
 * Adaptador legacy → parser central (BUG-WEBHOOK-005).
 * Preferir `parseIncomingWhatsAppEvent` en código nuevo.
 */

import type {
  ParsedWhatsAppMessage,
  WhatsAppAudioRef,
} from "@/lib/whatsapp/types";
import {
  parseIncomingWhatsAppEvent,
  type WhatsAppInboundEvent,
} from "@/lib/whatsapp/webhook-parser";

/** @deprecated usar extractAudio desde webhook-parser vía evento.audio */
export function extractAudio(message: {
  type?: string;
  audio?: {
    id?: string;
    mime_type?: string;
    sha256?: string;
    voice?: boolean;
  };
}): WhatsAppAudioRef | null {
  if (message.type !== "audio" || !message.audio?.id) {
    return null;
  }
  return {
    mediaId: message.audio.id,
    mimeType: message.audio.mime_type ?? null,
    sha256: message.audio.sha256 ?? null,
    isVoiceNote: message.audio.voice === true,
  };
}

export function inboundEventToParsedMessage(
  event: WhatsAppInboundEvent,
): ParsedWhatsAppMessage {
  return {
    phone: event.phone,
    name: event.profileName,
    text: event.text,
    button: event.button,
    location: event.location,
    audio: event.audio,
  };
}

/**
 * Parse del webhook → mensajes de frontera WhatsApp.
 * Delega en parseIncomingWhatsAppEvent (única fuente de verdad).
 */
export function parseIncomingMessages(
  payload: unknown,
  options?: { requestId?: string | null; silent?: boolean },
): ParsedWhatsAppMessage[] {
  const result = parseIncomingWhatsAppEvent(payload, options);
  return result.events.map(inboundEventToParsedMessage);
}
