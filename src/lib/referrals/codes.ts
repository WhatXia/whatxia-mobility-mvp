/**
 * Códigos y enlaces de referidos (REF-005: 100% WhatsApp).
 * Enlace a compartir: https://wa.me/573193455555?text=REF%20DRV-XXXXX
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_SUFFIX_LEN = 5;
const CODE_PREFIX = "DRV-";

/** Número oficial WhatXia (WhatsApp Business). */
export const WHATXIA_OFFICIAL_WHATSAPP_E164 = "573193455555";

/** Regex del código completo (case-insensitive). */
export const REFERRAL_CODE_PATTERN = /\bDRV-[A-HJ-NP-Z2-9]{5}\b/i;

/** Prefijo de mensaje WhatsApp al abrir el enlace. */
export const REFERRAL_WA_PREFIX = "REF";

export function isValidReferralCodeFormat(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return /^DRV-[A-HJ-NP-Z2-9]{5}$/i.test(value.trim());
}

export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Genera un código nuevo DRV-XXXXX (sin persistir). */
export function generateReferralCode(random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < CODE_SUFFIX_LEN; i += 1) {
    const idx = Math.floor(random() * CODE_ALPHABET.length);
    suffix += CODE_ALPHABET[idx] ?? "X";
  }
  return `${CODE_PREFIX}${suffix}`;
}

/**
 * Extrae un código DRV-XXXXX del texto entrante (p. ej. "REF DRV-AB12C").
 */
export function extractReferralCodeFromText(
  text: string | null | undefined,
): string | null {
  if (!text?.trim()) return null;
  const match = text.match(REFERRAL_CODE_PATTERN);
  if (!match?.[0]) return null;
  return normalizeReferralCode(match[0]);
}

/**
 * True si el mensaje es solo el token de referido (con o sin prefijo REF).
 * Se trata como saludo para continuar onboarding sin fricción.
 */
export function isReferralOnlyMessage(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  const normalized = text
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (isValidReferralCodeFormat(normalized)) return true;
  const withPrefix = normalized.match(
    new RegExp(`^${REFERRAL_WA_PREFIX}\\s+(DRV-[A-HJ-NP-Z2-9]{5})$`, "i"),
  );
  return Boolean(withPrefix);
}

/** Texto prellenado: `REF DRV-XXXXX`. */
export function buildReferralWhatsAppPrefill(code: string): string {
  return `${REFERRAL_WA_PREFIX} ${normalizeReferralCode(code)}`;
}

/**
 * Teléfono oficial para wa.me.
 * Prioriza env; por defecto el número de producción WhatXia.
 */
export function getWhatsAppBusinessPhoneE164(): string {
  const raw =
    process.env.WHATSAPP_BUSINESS_PHONE?.trim() ||
    process.env.NEXT_PUBLIC_WHATSAPP_PHONE?.trim() ||
    "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits || WHATXIA_OFFICIAL_WHATSAPP_E164;
}

/**
 * Enlace canónico a compartir (REF-005):
 * https://wa.me/573193455555?text=REF%20DRV-XXXXX
 */
export function buildWhatsAppDeepLink(code: string): string {
  const phone = getWhatsAppBusinessPhoneE164();
  const text = encodeURIComponent(buildReferralWhatsAppPrefill(code));
  return `https://wa.me/${phone}?text=${text}`;
}

/** Alias: el enlace de referidos es el deep link de WhatsApp. */
export function buildReferralLink(code: string): string {
  return buildWhatsAppDeepLink(code);
}

/**
 * Landing web legada `/r/[code]` (solo compatibilidad; no usar para compartir).
 */
export function buildLegacyWebReferralLink(code: string): string {
  const fromEnv =
    process.env.REFERRAL_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://whatxia.com";
  const base = fromEnv.replace(/\/$/, "");
  return `${base}/r/${normalizeReferralCode(code)}`;
}

/** @deprecated usar getWhatsAppBusinessPhoneE164 / buildReferralLink */
export function getReferralPublicBaseUrl(): string {
  return `https://wa.me/${getWhatsAppBusinessPhoneE164()}`;
}
