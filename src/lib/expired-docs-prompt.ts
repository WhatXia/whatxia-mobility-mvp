import { sendButtonsMessage } from "@/lib/whatsapp/client";

export const ACTUALIZAR_DOCUMENTOS_ID = "actualizar_documentos";

/** Aviso de documentos vencidos + botón para iniciar la actualización directa. */
export async function sendExpiredDocumentsPrompt(
  phone: string,
  body: string,
): Promise<void> {
  await sendButtonsMessage(phone, body, [
    {
      id: ACTUALIZAR_DOCUMENTOS_ID,
      title: "📄 Actualizar docs",
    },
  ]);
}
