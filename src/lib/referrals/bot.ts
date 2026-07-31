/**
 * Handlers WhatsApp del programa de referidos (REF-005: 100% wa.me).
 */

import { cms, cmsSync } from "@/lib/bot-cms/copy";
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
  return cmsSync("D_REF_SHARE_SUMMARY", {
    code: input.code,
    link: input.link,
    total: String(total),
  });
}

export function buildReferralCopyMessage(code: string, link: string): string {
  return cmsSync("D_REF_COPY", { code, link });
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
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
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
    await sendTextMessage(phone, await cms("D_REF_ERROR"));
  }

  await sendButtonsMessage(phone, await cms("D_REF_ACTIONS"), [
    { id: DRIVER_MENU_IDS.REFERIDOS_COPY, title: "📋 Copiar enlace" },
    { id: DRIVER_MENU_IDS.REFERIDOS_SHARE, title: "📤 Compartir" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}

/** Reenvía el wa.me para que el usuario lo copie (long-press). */
export async function handleDriverReferralCopy(phone: string): Promise<void> {
  const payload = await loadDriverReferralPayload(phone);
  if (!payload) {
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  await sendTextMessage(
    phone,
    buildReferralCopyMessage(payload.code, payload.link),
    { previewUrl: true },
  );
  await sendButtonsMessage(phone, await cms("D_REF_MORE"), [
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
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  const shareBody = encodeURIComponent(
    cmsSync("D_REF_SHARE_TEXT", { link: payload.link }),
  );
  const shareUrl = `https://wa.me/?text=${shareBody}`;

  await sendCtaUrlMessage(
    phone,
    await cms("D_REF_SHARE_CTA"),
    { displayText: "Compartir enlace", url: shareUrl },
  );
  await sendButtonsMessage(phone, await cms("D_REF_MORE"), [
    { id: DRIVER_MENU_IDS.REFERIDOS_COPY, title: "📋 Copiar enlace" },
    { id: DRIVER_MENU_IDS.REFERIDOS, title: "👥 Ver resumen" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}
