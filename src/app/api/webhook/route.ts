import { NextRequest, NextResponse } from "next/server";
import { handleIncomingMessage } from "@/lib/whatsapp/handler";
import { normalizeParsedMessage } from "@/lib/whatsapp/normalize-incoming";
import { parseIncomingMessages } from "@/lib/whatsapp/parse";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/verify";

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
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";

  if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody);
    const parsed = parseIncomingMessages(payload);

    for (const item of parsed) {
      const normalized = await normalizeParsedMessage(item);
      if (normalized.kind === "skip") {
        continue;
      }
      await handleIncomingMessage(normalized.message);
    }
  } catch (error) {
    console.error("[whatsapp] error al procesar webhook:", error);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
