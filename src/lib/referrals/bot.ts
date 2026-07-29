/**
 * Handlers WhatsApp del programa de referidos (REF-003 / REF-003.1).
 */

import { findDriverByPhone } from "@/lib/supabase/drivers";
import {
  getDriverReferralLink,
  getReferralStatsForDriver,
} from "@/lib/referrals";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import { DRIVER_MENU_IDS } from "@/lib/driver-menu";

export function buildReferralShareMessage(input: {
  code: string;
  link: string;
  totalReferrals?: number;
}): string {
  const total = input.totalReferrals ?? 0;
  return [
    "👥 Programa de Referidos",
    "",
    "Comparte este enlace con familiares y amigos.",
    "",
    "Toda persona que se registre mediante este enlace quedará asociada a tu cuenta.",
    "",
    `🏷️ Tu código: ${input.code}`,
    "",
    "🔗 Tu enlace:",
    input.link,
    "",
    `📊 Referidos registrados: ${total}`,
  ].join("\n");
}

export async function handleDriverReferrals(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  try {
    const { code, link } = await getDriverReferralLink(driver);
    let totalReferrals = 0;
    try {
      const stats = await getReferralStatsForDriver(driver.id);
      totalReferrals = stats.totalReferrals;
    } catch (statsError) {
      console.error("[referrals] stats:", statsError);
    }

    await sendTextMessage(
      phone,
      buildReferralShareMessage({ code, link, totalReferrals }),
      { previewUrl: true },
    );
  } catch (error) {
    console.error("[referrals] error al mostrar enlace:", error);
    await sendTextMessage(
      phone,
      "No pudimos generar tu enlace de referidos en este momento. Intenta de nuevo en unos minutos.",
    );
  }

  await sendButtonsMessage(phone, "¿Qué deseas hacer?", [
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}
