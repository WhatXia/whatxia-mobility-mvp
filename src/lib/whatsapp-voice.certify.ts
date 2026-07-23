/**
 * Certificación E2E voz (capa WhatsApp): parse → download → Whisper → Mobility text.
 * Usa fetch mockeado (sin red). Ejecutar: npx tsx src/lib/whatsapp-voice.certify.ts
 */
export {};

import { parseIncomingMessages } from "@/lib/whatsapp/parse";
import { normalizeParsedMessage } from "@/lib/whatsapp/normalize-incoming";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const sampleOgg = Buffer.from("OggS-fake-opus-for-whisper-test");

const voiceWebhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: "Ana" } }],
            messages: [
              {
                from: "57300999",
                type: "audio",
                audio: {
                  id: "media_voice_e2e",
                  mime_type: "audio/ogg; codecs=opus",
                  sha256: "x",
                  voice: true,
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

const textWebhook = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: "Ana" } }],
            messages: [
              {
                from: "57300999",
                type: "text",
                text: { body: "Hola" },
              },
            ],
          },
        },
      ],
    },
  ],
};

async function main() {
  process.env.WHATSAPP_TOKEN = "test-wa-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.VOICE_TRANSCRIPTION_PROVIDER = "openai_whisper";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes("graph.facebook.com")) {
      return new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/tmp",
          mime_type: "audio/ogg; codecs=opus",
          file_size: sampleOgg.length,
          id: "media_voice_e2e",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("lookaside.fbsbx.com")) {
      return new Response(new Uint8Array(sampleOgg), {
        status: 200,
        headers: { "Content-Type": "audio/ogg; codecs=opus" },
      });
    }

    if (url.includes("api.openai.com/v1/audio/transcriptions")) {
      return new Response(
        JSON.stringify({
          text: "Necesito un servicio en Jordán Octava Etapa",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`fetch inesperado en certify: ${url}`);
  }) as typeof fetch;

  try {
    const textParsed = parseIncomingMessages(textWebhook);
    const textNorm = await normalizeParsedMessage(textParsed[0]);
    assert(textNorm.kind === "ready", "texto → ready");
    if (textNorm.kind === "ready") {
      assert(textNorm.message.text === "Hola", "texto sin cambios");
      assert(!("audio" in textNorm.message), "dominio sin audio");
    }

    const voiceParsed = parseIncomingMessages(voiceWebhook);
    assert(voiceParsed[0].audio?.isVoiceNote === true, "parse nota de voz");

    const voiceNorm = await normalizeParsedMessage(voiceParsed[0]);
    assert(voiceNorm.kind === "ready", "voz → ready tras STT");
    if (voiceNorm.kind === "ready") {
      assert(
        voiceNorm.message.text ===
          "Necesito un servicio en Jordán Octava Etapa",
        "transcripción como text para Mobility",
      );
      assert(
        voiceNorm.message.phone === "57300999",
        "mismo teléfono hacia handler",
      );
      assert(!("audio" in voiceNorm.message), "Mobility no ve audio");
    }

    console.log("\nwhatsapp voice E2E (parse→download→whisper→text): OK");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
