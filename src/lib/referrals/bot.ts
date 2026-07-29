/**
 * Handlers WhatsApp del programa de referidos (REF-005: 100% wa.me).
 */

import { findDriverByPhone } from "@/lib/supabase/drivers";
import {
  getDriverReferralLink,
  getReferralStatsForDriver,
} from "@/lib/referrals";
import {
  sendButtonsMessage,
  sendCtaUrlMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";
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
    "Al abrirlo, llegan directo al chat oficial de WhatXia.",
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

export function buildReferralCopyMessage(code: string, link: string): string {
  return [
    "📋 Copia tu enlace de referidos",
    "",
    "Mantén pulsado el enlace para copiarlo:",
    "",
    `🏷️ Código: ${code}`,
    link,
  ].join("\n");
}

async function loadDriverReferralPayload(phone: string) {
  const driver = await findDriverByPhone(phone);
  if (!driver) return null;
  const { code, link } = await getDriverReferralLink(driver);
  let totalReferrals = 0;
  try {
    const stats = await getReferralStatsForDriver(driver.id);
    totalReferrals = stats.totalReferrals;
  } catch (statsError) {
    console.error("[referrals] stats:", statsError);
  }
  return { driver, code, link, totalReferrals };
}

export async function handleDriverReferrals(phone: string): Promise<void> {
  const payload = await loadDriverReferralPayload(phone);
  if (!payload) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  try {
    await sendTextMessage(
      phone,
      buildReferralShareMessage({
        code: payload.code,
        link: payload.link,
        totalReferrals: payload.totalReferrals,
      }),
      { previewUrl: true },
    );
  } catch (error) {
    console.error("[referrals] error al mostrar enlace:", error);
    await sendTextMessage(
      phone,
      "No pudimos generar tu enlace de referidos en este momento. Intenta de nuevo en unos minutos.",
    );
  }

  await sendButtonsMessage(phone, "¿Qué deseas hacer con tu enlace?", [
    { id: DRIVER_MENU_IDS.REFERIDOS_COPY, title: "📋 Copiar enlace" },
    { id: DRIVER_MENU_IDS.REFERIDOS_SHARE, title: "📤 Compartir" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}

/** Reenvía el wa.me para que el usuario lo copie (long-press). */
export async function handleDriverReferralCopy(phone: string): Promise<void> {
  const payload = await loadDriverReferralPayload(phone);
  if (!payload) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  await sendTextMessage(
    phone,
    buildReferralCopyMessage(payload.code, payload.link),
    { previewUrl: true },
  );
  await sendButtonsMessage(phone, "¿Algo más?", [
    { id: DRIVER_MENU_IDS.REFERIDOS_SHARE, title: "📤 Compartir" },
    { id: DRIVER_MENU_IDS.REFERIDOS, title: "👥 Ver resumen" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}

/**
 * Comparte el enlace wa.me del conductor (abre selector de chat de WhatsApp).
 */
export async function handleDriverReferralShare(phone: string): Promise<void> {
  const payload = await loadDriverReferralPayload(phone);
  if (!payload) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  const shareBody = encodeURIComponent(
    `Únete a WhatXia con mi enlace:\n${payload.link}`,
  );
  const shareUrl = `https://wa.me/?text=${shareBody}`;

  await sendCtaUrlMessage(
    phone,
    "📤 Comparte tu enlace. Quien lo abra llegará al chat oficial de WhatXia con tu código.",
    { displayText: "Compartir enlace", url: shareUrl },
  );
  await sendButtonsMessage(phone, "¿Algo más?", [
    { id: DRIVER_MENU_IDS.REFERIDOS_COPY, title: "📋 Copiar enlace" },
    { id: DRIVER_MENU_IDS.REFERIDOS, title: "👥 Ver resumen" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}
