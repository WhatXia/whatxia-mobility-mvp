/**
 * BUG-WEBHOOK-005 — Parser central WhatsApp Cloud API.
 * Único punto de adaptación si Meta cambia el payload.
 */

import type { IncomingLocation } from "@/types";
import type { WhatsAppAudioRef } from "@/lib/whatsapp/types";

export type WhatsAppImageRef = {
  mediaId: string;
  mimeType: string | null;
  sha256: string | null;
  caption: string | null;
};

export type WhatsAppInboundEvent = {
  /** Remitente resuelto (wa_id / from). Nunca el nombre de perfil. */
  phone: string;
  /** Solo display; puede traer emojis, Instagram, caracteres especiales. */
  profileName: string;
  messageType: string;
  /** Alias de messageType (contrato BUG-WEBHOOK-005). */
  type: string;
  /** Cuerpo de texto principal (text.body o caption). */
  body: string | null;
  text: string | null;
  image: WhatsAppImageRef | null;
  audio: WhatsAppAudioRef | null;
  location: IncomingLocation | null;
  interactive: Record<string, unknown> | null;
  button: string | null;
};

export type ParseIncomingWhatsAppError = {
  reason: string;
  messageType: string | null;
  body: string | null;
  requestId: string | null;
};

export type ParseIncomingWhatsAppResult = {
  events: WhatsAppInboundEvent[];
  errors: ParseIncomingWhatsAppError[];
};

type ParseOptions = {
  requestId?: string | null;
  /** Si true, no loguea (tests). Default: loguear. */
  silent?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Remitente: nunca profile.name / Instagram / @usuario.
 * Orden: messages[].from → contacts[].wa_id → statuses[].recipient_id
 */
export function resolveWhatsAppSenderPhone(
  message: Record<string, unknown> | null,
  value: Record<string, unknown>,
): { phone: string | null; source: string | null } {
  const from = message ? asString(message.from) : null;
  if (from) return { phone: from, source: "messages.from" };

  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  for (const contact of contacts) {
    const row = asRecord(contact);
    const waId = row ? asString(row.wa_id) : null;
    if (waId) return { phone: waId, source: "contacts.wa_id" };
  }

  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  for (const status of statuses) {
    const row = asRecord(status);
    const recipientId = row ? asString(row.recipient_id) : null;
    if (recipientId) return { phone: recipientId, source: "statuses.recipient_id" };
  }

  return { phone: null, source: null };
}

function extractProfileName(value: Record<string, unknown>): string {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  for (const contact of contacts) {
    const row = asRecord(contact);
    const profile = row ? asRecord(row.profile) : null;
    const name = profile ? asString(profile.name) : null;
    if (name) return name;
  }
  return "";
}

function extractButton(message: Record<string, unknown>): string | null {
  const interactive = asRecord(message.interactive);
  if (interactive) {
    const buttonReply = asRecord(interactive.button_reply);
    if (buttonReply) {
      return asString(buttonReply.id) ?? asString(buttonReply.title);
    }
    const listReply = asRecord(interactive.list_reply);
    if (listReply) {
      return asString(listReply.id) ?? asString(listReply.title);
    }
  }

  const button = asRecord(message.button);
  if (button) {
    return asString(button.payload) ?? asString(button.text);
  }

  return null;
}

function extractLocation(
  message: Record<string, unknown>,
  messageType: string,
): IncomingLocation | null {
  if (messageType !== "location") return null;
  const location = asRecord(message.location);
  if (!location) return null;
  const lat = asNumber(location.latitude);
  const lng = asNumber(location.longitude);
  if (lat == null || lng == null) return null;
  return {
    lat,
    lng,
    name: asString(location.name),
    address: asString(location.address),
  };
}

function extractAudio(
  message: Record<string, unknown>,
  messageType: string,
): WhatsAppAudioRef | null {
  if (messageType !== "audio") return null;
  const audio = asRecord(message.audio);
  const id = audio ? asString(audio.id) : null;
  if (!id) return null;
  return {
    mediaId: id,
    mimeType: audio ? asString(audio.mime_type) : null,
    sha256: audio ? asString(audio.sha256) : null,
    isVoiceNote: audio?.voice === true,
  };
}

function extractImage(
  message: Record<string, unknown>,
  messageType: string,
): WhatsAppImageRef | null {
  if (messageType !== "image") return null;
  const image = asRecord(message.image);
  const id = image ? asString(image.id) : null;
  if (!id) return null;
  return {
    mediaId: id,
    mimeType: image ? asString(image.mime_type) : null,
    sha256: image ? asString(image.sha256) : null,
    caption: image ? asString(image.caption) : null,
  };
}

function extractTextBody(
  message: Record<string, unknown>,
  messageType: string,
  image: WhatsAppImageRef | null,
): string | null {
  if (messageType === "text") {
    const text = asRecord(message.text);
    return text ? asString(text.body) : null;
  }
  if (image?.caption) return image.caption;
  return null;
}

function firstContactWaId(value: Record<string, unknown> | null): string | null {
  if (!value || !Array.isArray(value.contacts) || value.contacts.length === 0) {
    return null;
  }
  const row = asRecord(value.contacts[0]);
  return row ? asString(row.wa_id) : null;
}

function firstStatusRecipientId(
  value: Record<string, unknown> | null,
): string | null {
  if (!value || !Array.isArray(value.statuses) || value.statuses.length === 0) {
    return null;
  }
  const row = asRecord(value.statuses[0]);
  return row ? asString(row.recipient_id) : null;
}

/** DIAG-007: clasifica el change.value de Meta. */
export function detectWebhookEventKind(
  value: Record<string, unknown> | null,
): "messages" | "statuses" | "other" {
  if (!value) return "other";
  if (Array.isArray(value.messages) && value.messages.length > 0) {
    return "messages";
  }
  if (Array.isArray(value.statuses) && value.statuses.length > 0) {
    return "statuses";
  }
  return "other";
}

/**
 * DIAG-007 — Log estándar BUG-WEBHOOK-005 (solo diagnóstico; no altera flujo).
 */
export function logBugWebhook005(input: {
  reason: string;
  requestId: string | null;
  messageFrom?: unknown;
  contacts0WaId?: string | null;
  statuses0RecipientId?: string | null;
  event?: "messages" | "statuses" | "other";
  /** Payload completo solo si no se resolvió el remitente (u otro fallo de parse). */
  payload?: unknown;
  includePayload?: boolean;
  silent?: boolean;
  extra?: Record<string, unknown>;
}) {
  if (input.silent) return;
  console.error({
    level: "error",
    code: "BUG-WEBHOOK-005",
    requestId: input.requestId,
    reason: input.reason,
    "message.from": input.messageFrom ?? null,
    "contacts[0].wa_id": input.contacts0WaId ?? null,
    "statuses[0].recipient_id": input.statuses0RecipientId ?? null,
    event: input.event ?? "other",
    ...(input.includePayload ? { payload: input.payload ?? null } : {}),
    ...(input.extra ?? {}),
  });
}

function logUnresolvedSender(input: {
  requestId: string | null;
  reason: string;
  messageType: string | null;
  body: string | null;
  payload: unknown;
  value: Record<string, unknown>;
  message: Record<string, unknown> | null;
  silent?: boolean;
}) {
  logBugWebhook005({
    reason: input.reason,
    requestId: input.requestId,
    messageFrom: input.message ? input.message.from : null,
    contacts0WaId: firstContactWaId(input.value),
    statuses0RecipientId: firstStatusRecipientId(input.value),
    event: detectWebhookEventKind(input.value),
    payload: input.payload,
    includePayload: true,
    silent: input.silent,
    extra: {
      messageType: input.messageType,
      body: input.body,
      attemptedSources: [
        "messages.from",
        "contacts.wa_id",
        "statuses.recipient_id",
      ],
    },
  });
}

/**
 * Parser único del webhook Cloud API.
 * Todo el bot debe consumir esta función (BUG-WEBHOOK-005).
 */
export function parseIncomingWhatsAppEvent(
  payload: unknown,
  options?: ParseOptions,
): ParseIncomingWhatsAppResult {
  const requestId = options?.requestId ?? null;
  const silent = Boolean(options?.silent);
  const events: WhatsAppInboundEvent[] = [];
  const errors: ParseIncomingWhatsAppError[] = [];

  const root = asRecord(payload);
  if (!root) {
    const reason = "payload_not_object";
    errors.push({ reason, messageType: null, body: null, requestId });
    logBugWebhook005({
      reason,
      requestId,
      messageFrom: null,
      contacts0WaId: null,
      statuses0RecipientId: null,
      event: "other",
      payload,
      includePayload: true,
      silent,
    });
    return { events, errors };
  }

  if (root.object !== "whatsapp_business_account") {
    return { events, errors };
  }

  const entries = Array.isArray(root.entry) ? root.entry : [];

  for (const entry of entries) {
    const entryRow = asRecord(entry);
    const changes = entryRow && Array.isArray(entryRow.changes)
      ? entryRow.changes
      : [];

    for (const change of changes) {
      const changeRow = asRecord(change);
      const value = changeRow ? asRecord(changeRow.value) : null;
      if (!value) continue;

      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (messages.length === 0) {
        // Status / otros cambios sin mensaje de usuario: no es error de remitente.
        continue;
      }

      const profileName = extractProfileName(value);

      for (const rawMessage of messages) {
        const message = asRecord(rawMessage);
        const messageType = message
          ? asString(message.type) ?? "unknown"
          : "unknown";
        const image = message ? extractImage(message, messageType) : null;
        const text = message
          ? extractTextBody(message, messageType, image)
          : null;
        const body = text;

        const { phone, source } = resolveWhatsAppSenderPhone(message, value);

        if (!phone) {
          const reason = "sender_phone_unresolved";
          errors.push({ reason, messageType, body, requestId });
          logUnresolvedSender({
            requestId,
            reason,
            messageType,
            body,
            payload,
            value,
            message,
            silent,
          });
          continue;
        }

        const event: WhatsAppInboundEvent = {
          phone,
          profileName,
          messageType,
          type: messageType,
          body,
          text,
          image,
          audio: message ? extractAudio(message, messageType) : null,
          location: message ? extractLocation(message, messageType) : null,
          interactive: message ? asRecord(message.interactive) : null,
          button: message ? extractButton(message) : null,
        };

        if (!silent) {
          console.log({
            requestId,
            phone: event.phone,
            profileName: event.profileName,
            messageType: event.messageType,
            body: event.body,
            senderSource: source,
          });
        }

        events.push(event);
      }
    }
  }

  return { events, errors };
}
