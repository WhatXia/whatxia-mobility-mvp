/**
 * OpenAI Whisper — transcripción de audio (capa integración WhatsApp).
 * Mobility no importa este módulo.
 */

import type { TranscriptionProvider } from "@/lib/voice/provider";
import type {
  TranscriptionInput,
  TranscriptionResult,
} from "@/lib/whatsapp/types";

function extensionForMime(mimeType: string | null): string {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  // Notas de voz WA: audio/ogg; codecs=opus
  return "ogg";
}

export class OpenAiWhisperProvider implements TranscriptionProvider {
  readonly id = "openai_whisper";

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Falta OPENAI_API_KEY para transcribir audio.");
    }

    const model =
      process.env.OPENAI_WHISPER_MODEL?.trim() || "whisper-1";
    const language =
      input.language?.trim() ||
      process.env.OPENAI_WHISPER_LANGUAGE?.trim() ||
      "es";

    const ext = extensionForMime(input.mimeType);
    const filename = `whatsapp-audio.${ext}`;
    const blobType = input.mimeType?.split(";")[0]?.trim() || "audio/ogg";

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.bytes)], { type: blobType }),
      filename,
    );
    form.append("model", model);
    form.append("language", language);
    form.append("response_format", "json");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
      },
    );

    const bodyText = await response.text();
    if (!response.ok) {
      console.error("[voice:whisper] error OpenAI:", {
        status: response.status,
        body: bodyText.slice(0, 500),
      });
      throw new Error(
        `Whisper HTTP ${response.status}: ${bodyText.slice(0, 200)}`,
      );
    }

    let data: { text?: string };
    try {
      data = JSON.parse(bodyText) as { text?: string };
    } catch {
      throw new Error("Whisper devolvió una respuesta no JSON.");
    }

    const text = data.text?.trim() ?? "";
    if (!text) {
      throw new Error("Whisper devolvió texto vacío.");
    }

    return { text, provider: this.id };
  }
}
