import type { IncomingMessage } from "@/types";
import type {
  ParsedWhatsAppMessage,
  WhatsAppAudioRef,
} from "@/lib/whatsapp/types";

type WhatsAppContact = {
  wa_id?: string;
  profile?: { name?: string };
};

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { text?: string; payload?: string };
  /**
   * Cloud API: type === "audio"
   * Nota de voz: mime_type "audio/ogg; codecs=opus", voice: true
   * Archivo de audio: p.ej. audio/mpeg, voice ausente o false
   */
  audio?: {
    id?: string;
    mime_type?: string;
    sha256?: string;
    voice?: boolean;
  };
};

type WhatsAppChangeValue = {
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: WhatsAppChangeValue;
    }>;
  }>;
};

function extractButton(message: WhatsAppMessage): string | null {
  if (message.interactive?.button_reply) {
    return (
      message.interactive.button_reply.id ??
      message.interactive.button_reply.title ??
      null
    );
  }

  if (message.interactive?.list_reply) {
    return (
      message.interactive.list_reply.id ??
      message.interactive.list_reply.title ??
      null
    );
  }

  if (message.button) {
    return message.button.payload ?? message.button.text ?? null;
  }

  return null;
}

function extractLocation(
  message: WhatsAppMessage,
): IncomingMessage["location"] {
  if (message.type !== "location" || !message.location) {
    return null;
  }

  const lat = message.location.latitude;
  const lng = message.location.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  return {
    lat,
    lng,
    name: message.location.name ?? null,
    address: message.location.address ?? null,
  };
}

/**
 * Extrae referencia de media de notas de voz / audio.
 * Solo capa WhatsApp; no descarga ni transcribe.
 */
export function extractAudio(message: WhatsAppMessage): WhatsAppAudioRef | null {
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

/**
 * Parse del webhook → mensajes de frontera WhatsApp (pueden incluir audio).
 * No devolver este tipo a booking/dispatch/intent.
 */
export function parseIncomingMessages(
  payload: WhatsAppWebhookPayload,
): ParsedWhatsAppMessage[] {
  if (payload.object !== "whatsapp_business_account" || !payload.entry) {
    return [];
  }

  const messages: ParsedWhatsAppMessage[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) {
        continue;
      }

      const contactName = value.contacts?.[0]?.profile?.name ?? "";

      for (const message of value.messages) {
        if (!message.from) {
          continue;
        }

        messages.push({
          phone: message.from,
          name: contactName,
          text: message.text?.body ?? null,
          button: extractButton(message),
          location: extractLocation(message),
          audio: extractAudio(message),
        });
      }
    }
  }

  return messages;
}
