import type { IncomingMessage } from "@/types";

type WhatsAppContact = {
  wa_id?: string;
  profile?: { name?: string };
};

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { text?: string; payload?: string };
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

export function parseIncomingMessages(
  payload: WhatsAppWebhookPayload,
): IncomingMessage[] {
  if (payload.object !== "whatsapp_business_account" || !payload.entry) {
    return [];
  }

  const messages: IncomingMessage[] = [];

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
        });
      }
    }
  }

  return messages;
}
