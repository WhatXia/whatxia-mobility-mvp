import { redirect } from "next/navigation";
import {
  buildWhatsAppDeepLink,
  isValidReferralCodeFormat,
  normalizeReferralCode,
} from "@/lib/referrals/codes";
import {
  findDriverByReferralCode,
  isActiveReferrerDriver,
  recordReferralEvent,
} from "@/lib/referrals";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ code: string }>;
};

/**
 * Landing pública del enlace de referido.
 * Valida el código, audita el clic y redirige a WhatsApp con el token.
 */
export default async function ReferralLandingPage({ params }: PageProps) {
  const { code: raw } = await params;
  const code = normalizeReferralCode(decodeURIComponent(raw || ""));

  if (!isValidReferralCodeFormat(code)) {
    redirect("/");
  }

  const driver = await findDriverByReferralCode(code);
  if (!driver || !isActiveReferrerDriver(driver)) {
    redirect("/");
  }

  try {
    await recordReferralEvent({
      eventType: "link_opened",
      referralCode: code,
      referrerDriverId: driver.id,
      meta: { path: `/r/${code}` },
    });
  } catch (error) {
    console.error("[referrals] link_opened:", error);
  }

  redirect(buildWhatsAppDeepLink(code));
}
