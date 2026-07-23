/**
 * Tipos de la capa WhatsApp (integración).
 * No exportar hacia dominio Mobility: booking/dispatch/intent solo ven IncomingMessage.
 */

import type { IncomingMessage } from "@/types";

/** Metadata de audio/nota de voz tal como llega en el webhook Cloud API. */
export type WhatsAppAudioRef = {
  /** ID de media Graph (válido ~7 días). */
  mediaId: string;
  /** Ej: "audio/ogg; codecs=opus" en notas de voz. */
  mimeType: string | null;
  sha256: string | null;
  /**
   * true = nota de voz grabada en WhatsApp (voice note).
   * false/omitido = archivo de audio adjunto.
   */
  isVoiceNote: boolean;
};

/**
 * Mensaje parseado en la frontera WhatsApp.
 * Incluye opcionalmente audio; Mobility nunca debe recibir este tipo.
 */
export type ParsedWhatsAppMessage = IncomingMessage & {
  audio: WhatsAppAudioRef | null;
};

/** Entrada al proveedor de STT (Etapa 3; contrato Etapa 0). */
export type TranscriptionInput = {
  bytes: Buffer;
  mimeType: string | null;
  /** Idioma BCP-47 preferido; es-CO / es por defecto en Whisper. */
  language?: string;
};

export type TranscriptionResult = {
  text: string;
  provider: string;
};
