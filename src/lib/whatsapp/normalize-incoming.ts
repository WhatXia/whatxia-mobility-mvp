/**
 * Normaliza mensajes WhatsApp → IncomingMessage para Mobility.
 * Audio: descarga + Whisper → text. Mobility nunca ve audio.
 */

import type { IncomingMessage } from "@/types";
import { cms } from "@/lib/bot-cms/copy";
import { getTranscriptionProvider } from "@/lib/voice/provider";
import {
  downloadWhatsAppMedia,
  WhatsAppMediaError,
} from "@/lib/whatsapp/media";
import type { ParsedWhatsAppMessage } from "@/lib/whatsapp/types";
import { sendTextMessage } from "@/lib/whatsapp/client";

export type NormalizeResult =
  | { kind: "ready"; message: IncomingMessage }
  | { kind: "skip" };

function toDomainMessage(
  parsed: ParsedWhatsAppMessage,
  textOverride?: string | null,
): IncomingMessage {
  return {
    phone: parsed.phone,
    name: parsed.name,
    text: textOverride !== undefined ? textOverride : parsed.text,
    button: parsed.button,
    location: parsed.location,
  };
}

async function downloadWithUrlRetry(mediaId: string) {
  try {
    return await downloadWhatsAppMedia(mediaId);
  } catch (error) {
    if (error instanceof WhatsAppMediaError && error.code === "url_expired") {
      console.warn("[whatsapp:normalize] URL expirada; reintentando lookup", {
        mediaId,
      });
      return await downloadWhatsAppMedia(mediaId);
    }
    throw error;
  }
}

async function resolveAudioToText(
  parsed: ParsedWhatsAppMessage,
): Promise<string | null> {
  const audio = parsed.audio;
  if (!audio) {
    return null;
  }

  console.log("[whatsapp:normalize] transcribiendo audio", {
    phone: parsed.phone,
    mediaId: audio.mediaId,
    mimeType: audio.mimeType,
    isVoiceNote: audio.isVoiceNote,
  });

  try {
    const media = await downloadWithUrlRetry(audio.mediaId);
    const provider = getTranscriptionProvider();
    const result = await provider.transcribe({
      bytes: media.bytes,
      mimeType: media.mimeType ?? audio.mimeType,
      language: "es",
    });

    const text = result.text.trim();
    console.log("[whatsapp:normalize] transcripción OK", {
      phone: parsed.phone,
      provider: result.provider,
      textPreview: text.slice(0, 120),
    });
    return text;
  } catch (error) {
    console.error("[whatsapp:normalize] fallo al transcribir:", error);
    try {
      const { handleMaintenanceIfNeeded } = await import(
        "@/lib/bot-operational-status/config"
      );
      // SYS-001: en mantenimiento no enviar errores de audio; solo el mensaje ops.
      if (await handleMaintenanceIfNeeded(parsed.phone)) {
        return null;
      }
    } catch (maintErr) {
      console.error("[whatsapp:normalize] check mantenimiento:", maintErr);
    }
    await sendTextMessage(
      parsed.phone,
      await cms("SYS_AUDIO_FAIL"),
    ).catch((sendError) => {
      console.error(
        "[whatsapp:normalize] no se pudo avisar fallo de audio:",
        sendError,
      );
    });
    return null;
  }
}

/**
 * Convierte parse WhatsApp → mensaje de dominio (solo text/button/location).
 */
export async function normalizeParsedMessage(
  parsed: ParsedWhatsAppMessage,
): Promise<NormalizeResult> {
  if (parsed.audio) {
    const text = await resolveAudioToText(parsed);
    if (!text) {
      return { kind: "skip" };
    }
    return { kind: "ready", message: toDomainMessage(parsed, text) };
  }

  const hasContent =
    Boolean(parsed.text?.trim()) ||
    Boolean(parsed.button) ||
    Boolean(parsed.location);

  if (!hasContent) {
    return { kind: "skip" };
  }

  return { kind: "ready", message: toDomainMessage(parsed) };
}
