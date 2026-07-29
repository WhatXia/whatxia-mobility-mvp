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

function InvalidReferralView({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily:
          "Segoe UI, system-ui, -apple-system, sans-serif",
        background: "linear-gradient(180deg, #f3f6f4 0%, #e7eeea 100%)",
        color: "#14201b",
      }}
    >
      <section
        style={{
          maxWidth: 420,
          width: "100%",
          background: "#fff",
          border: "1px solid #d5e0da",
          borderRadius: 16,
          padding: "1.75rem",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#1f6b4f",
            margin: 0,
          }}
        >
          WhatXia Referidos
        </p>
        <h1 style={{ fontSize: 22, margin: "0.75rem 0 0.5rem" }}>{title}</h1>
        <p style={{ margin: 0, color: "#3d5248", lineHeight: 1.5 }}>{detail}</p>
        <p style={{ marginTop: "1.25rem", fontSize: 14, color: "#5a6f64" }}>
          Si recibiste este enlace de un conductor WhatXia, pídele que te lo
          reenvíe o escribe directamente al WhatsApp oficial.
        </p>
      </section>
    </main>
  );
}

async function auditInvalid(
  code: string,
  reason: string,
  referrerDriverId?: string | null,
) {
  try {
    await recordReferralEvent({
      eventType: "invalid_code",
      referralCode: code || "INVALID",
      referrerDriverId: referrerDriverId ?? null,
      meta: { reason, path: `/r/${code || ""}` },
    });
  } catch (error) {
    console.error("[referrals] invalid_code:", error);
  }
}

/**
 * Landing web legada `/r/[code]` (REF-005: solo compatibilidad).
 * Los nuevos referidos usan wa.me directo; esta ruta redirige al chat oficial.
 */
export default async function ReferralLandingPage({ params }: PageProps) {
  const { code: raw } = await params;
  const decoded = decodeURIComponent(raw || "").trim();
  const code = decoded ? normalizeReferralCode(decoded) : "";

  if (!isValidReferralCodeFormat(code)) {
    await auditInvalid(decoded || code, "bad_format");
    return (
      <InvalidReferralView
        title="Enlace no válido"
        detail="El código de referido no tiene un formato reconocido."
      />
    );
  }

  const driver = await findDriverByReferralCode(code);
  if (!driver) {
    await auditInvalid(code, "not_found");
    return (
      <InvalidReferralView
        title="Código no encontrado"
        detail="No existe un conductor asociado a este enlace de referidos."
      />
    );
  }

  if (!isActiveReferrerDriver(driver)) {
    await auditInvalid(code, "driver_disabled", driver.id);
    return (
      <InvalidReferralView
        title="Enlace no disponible"
        detail="Este código de referido está deshabilitado temporalmente."
      />
    );
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
