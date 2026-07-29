/**
 * Handlers WhatsApp del programa de referidos (REF-003).
 */

import { findDriverByPhone } from "@/lib/supabase/drivers";
import { getDriverReferralLink } from "@/lib/referrals";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import { DRIVER_MENU_IDS } from "@/lib/driver-menu";

export function buildReferralShareMessage(link: string): string {
  return [
    "👥 Programa de Referidos",
    "",
    "Comparte este enlace con familiares y amigos.",
    "",
    "Toda persona que se registre mediante este enlace quedará asociada a tu cuenta.",
    "",
    "🔗 Tu enlace:",
    link,
  ].join("\n");
}

export async function handleDriverReferrals(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  try {
    const { link } = await getDriverReferralLink(driver);
    await sendTextMessage(phone, buildReferralShareMessage(link), {
      previewUrl: true,
    });
  } catch (error) {
    console.error("[referrals] error al mostrar enlace:", error);
    await sendTextMessage(
      phone,
      "No pudimos generar tu enlace de referidos en este momento. Intenta de nuevo en unos minutos.",
    );
  }

  await sendButtonsMessage(phone, "¿Qué deseas hacer?", [
    { id: DRIVER_MENU_IDS.VOLVER_PRINCIPAL, title: "⬅️ Volver al menú" },
  ]);
}
