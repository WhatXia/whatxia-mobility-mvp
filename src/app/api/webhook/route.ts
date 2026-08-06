import { NextRequest, NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/whatsapp/handler";
import { normalizeParsedMessage } from "@/lib/whatsapp/normalize-incoming";
import { inboundEventToParsedMessage } from "@/lib/whatsapp/parse";
import {
  logBugWebhook005,
  parseIncomingWhatsAppEvent,
} from "@/lib/whatsapp/webhook-parser";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/verify";

function resolveRequestId(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-id") ||
    request.headers.get("x-request-id") ||
    request.headers.get("x-amzn-trace-id") ||
    crypto.randomUUID()
  );
}

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && challenge && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const requestId = resolveRequestId(request);
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
    logBugWebhook005({
      reason: "invalid_signature",
      requestId,
      messageFrom: null,
      contacts0WaId: null,
      statuses0RecipientId: null,
      event: "other",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      logBugWebhook005({
        reason: "json_parse_failed",
        requestId,
        messageFrom: null,
        contacts0WaId: null,
        statuses0RecipientId: null,
        event: "other",
        payload: rawBody.slice(0, 8000),
        includePayload: true,
        extra: {
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        },
      });
      // Meta exige 200 para no reintentar indefinidamente; queda traza completa.
      return NextResponse.json({
        ok: true,
        requestId,
        warning: "json_parse_failed",
      });
    }

    const parsed = parseIncomingWhatsAppEvent(payload, { requestId });

    if (parsed.errors.length > 0) {
      logBugWebhook005({
        reason: "inbound_parse_errors",
        requestId,
        messageFrom: null,
        contacts0WaId: null,
        statuses0RecipientId: null,
        event: "other",
        // Detalle por mensaje (incl. message.from / wa_id / recipient_id / payload)
        // ya se emitió en parseIncomingWhatsAppEvent.
        extra: {
          errorCount: parsed.errors.length,
          errors: parsed.errors,
        },
      });
    }

    for (const event of parsed.events) {
      // Contrato BUG-WEBHOOK-005: solo campos del parser central.
      const frontier = inboundEventToParsedMessage(event);
      const normalized = await normalizeParsedMessage(frontier);
      if (normalized.kind === "skip") {
        console.log({
          requestId,
          phone: event.phone,
          profileName: event.profileName,
          messageType: event.type,
          body: event.body,
          skipped: true,
        });
        continue;
      }
      await handleIncomingMessage(normalized.message);
    }
  } catch (error) {
    logBugWebhook005({
      reason: "webhook_processing_exception",
      requestId,
      messageFrom: null,
      contacts0WaId: null,
      statuses0RecipientId: null,
      event: "other",
      extra: {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
  }

  return NextResponse.json({ ok: true, requestId });
}
