/**
 * Orígenes de registro (USER-001.1 — marketing / adquisición).
 */

export const REGISTRATION_SOURCES = [
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "REFERRAL",
  "QR",
  "ORGANIC",
  "OTHER",
] as const;

export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

export const REGISTRATION_SOURCE_LABELS: Record<RegistrationSource, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  REFERRAL: "Referido",
  QR: "QR",
  ORGANIC: "Orgánico",
  OTHER: "Otro",
};

export function isRegistrationSource(
  value: unknown,
): value is RegistrationSource {
  return (
    typeof value === "string" &&
    (REGISTRATION_SOURCES as readonly string[]).includes(value)
  );
}

/** Parsea respuesta numérica 1–7 del onboarding WhatsApp. */
export function parseRegistrationSourceChoice(
  raw: string,
): RegistrationSource | null {
  const trimmed = raw.trim();
  const byNumber: Record<string, RegistrationSource> = {
    "1": "INSTAGRAM",
    "2": "FACEBOOK",
    "3": "TIKTOK",
    "4": "REFERRAL",
    "5": "QR",
    "6": "ORGANIC",
    "7": "OTHER",
  };
  if (byNumber[trimmed]) {
    return byNumber[trimmed];
  }

  const normalized = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  const byLabel: Record<string, RegistrationSource> = {
    instagram: "INSTAGRAM",
    facebook: "FACEBOOK",
    tiktok: "TIKTOK",
    referido: "REFERRAL",
    referral: "REFERRAL",
    qr: "QR",
    organico: "ORGANIC",
    organic: "ORGANIC",
    otro: "OTHER",
    other: "OTHER",
  };

  return byLabel[normalized] ?? null;
}

export const REGISTRATION_SOURCE_PROMPT = [
  "¿Cómo nos conociste?",
  "",
  "1. Instagram",
  "2. Facebook",
  "3. TikTok",
  "4. Referido",
  "5. QR",
  "6. Orgánico",
  "7. Otro",
  "",
  "Responde con el número de la opción.",
].join("\n");
