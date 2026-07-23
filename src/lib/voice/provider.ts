/**
 * Contrato de transcripción de voz (capa integración).
 * Mobility no importa este módulo.
 */

import { OpenAiWhisperProvider } from "@/lib/voice/openai-whisper";
import type {
  TranscriptionInput,
  TranscriptionResult,
} from "@/lib/whatsapp/types";

export type { TranscriptionInput, TranscriptionResult };

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

/**
 * Resuelve el proveedor de transcripción (default: openai_whisper).
 */
export function getTranscriptionProvider(): TranscriptionProvider {
  const name = (process.env.VOICE_TRANSCRIPTION_PROVIDER ?? "openai_whisper")
    .trim()
    .toLowerCase();

  if (name === "openai_whisper" || name === "whisper") {
    return new OpenAiWhisperProvider();
  }

  throw new Error(
    `Proveedor de transcripción desconocido: ${name}. Use openai_whisper.`,
  );
}
