/**
 * Certificación BUG-WEBHOOK-005 — parser robusto de remitente.
 * Ejecutar: npx tsx src/lib/whatsapp/webhook-parser.certify.ts
 */

import {
  parseIncomingWhatsAppEvent,
  resolveWhatsAppSenderPhone,
} from "@/lib/whatsapp/webhook-parser";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

// 1) from presente
{
  const r = parseIncomingWhatsAppEvent(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [
                  {
                    wa_id: "573001111111",
                    profile: { name: "Ana 🔥 desde Instagram" },
                  },
                ],
                messages: [
                  {
                    from: "573001111111",
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { requestId: "test-1", silent: true },
  );
  assert(r.events.length === 1, "from → 1 evento");
  assert(r.events[0].phone === "573001111111", "phone desde from");
  assert(
    r.events[0].profileName === "Ana 🔥 desde Instagram",
    "profileName con emoji/Instagram no rompe",
  );
  assert(r.events[0].body === "Hola", "body Hola");
  assert(r.errors.length === 0, "sin errores");
}

// 2) from ausente → contacts.wa_id (caso producción BUG-WEBHOOK-005)
{
  const r = parseIncomingWhatsAppEvent(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [
                  {
                    wa_id: "573002222222",
                    profile: { name: "@usuario_ig" },
                  },
                ],
                messages: [
                  {
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { requestId: "test-2", silent: true },
  );
  assert(r.events.length === 1, "wa_id fallback → 1 evento");
  assert(r.events[0].phone === "573002222222", "phone desde contacts.wa_id");
  assert(r.events[0].body === "Hola", "body preservado sin from");
  assert(r.errors.length === 0, "wa_id sin error");
}

// 3) from + wa_id ausentes → statuses.recipient_id
{
  const r = parseIncomingWhatsAppEvent(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Sin wa_id" } }],
                statuses: [{ recipient_id: "573003333333", status: "delivered" }],
                messages: [
                  {
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { requestId: "test-3", silent: true },
  );
  assert(r.events.length === 1, "recipient_id fallback → 1 evento");
  assert(
    r.events[0].phone === "573003333333",
    "phone desde statuses.recipient_id",
  );
}

// 4) ningún identificador → error controlado, sin evento
{
  const r = parseIncomingWhatsAppEvent(
    {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Solo nombre" } }],
                messages: [
                  {
                    type: "text",
                    text: { body: "Hola" },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    { requestId: "test-4", silent: true },
  );
  assert(r.events.length === 0, "sin phone → 0 eventos");
  assert(r.errors.length === 1, "error controlado");
  assert(
    r.errors[0].reason === "sender_phone_unresolved",
    "reason sender_phone_unresolved",
  );
  assert(r.errors[0].requestId === "test-4", "requestId en error");
}

// 5) resolve helper: nunca usa profile.name
{
  const resolved = resolveWhatsAppSenderPhone(
    { type: "text", text: { body: "Hola" } },
    {
      contacts: [{ profile: { name: "573009999999" } }],
    },
  );
  assert(resolved.phone === null, "profile.name nunca es phone");
}

console.log("webhook-parser.certify: OK (BUG-WEBHOOK-005)");
