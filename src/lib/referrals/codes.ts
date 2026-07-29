/**
 * Códigos y enlaces de referidos (REF-003).
 * Formato: DRV-XXXXX (alfanumérico sin ambiguos).
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_SUFFIX_LEN = 5;
const CODE_PREFIX = "DRV-";

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
 * Se puede tratar como saludo sin cambiar el onboarding.
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

export function getReferralPublicBaseUrl(): string {
  const fromEnv =
    process.env.REFERRAL_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://whatxia.com";
  return fromEnv.replace(/\/$/, "");
}

export function buildReferralLink(code: string): string {
  const normalized = normalizeReferralCode(code);
  return `${getReferralPublicBaseUrl()}/r/${normalized}`;
}

/** Texto prellenado al abrir WhatsApp desde /r/[code]. */
export function buildReferralWhatsAppPrefill(code: string): string {
  return `${REFERRAL_WA_PREFIX} ${normalizeReferralCode(code)}`;
}

export function getWhatsAppBusinessPhoneE164(): string | null {
  const raw =
    process.env.WHATSAPP_BUSINESS_PHONE?.trim() ||
    process.env.NEXT_PUBLIC_WHATSAPP_PHONE?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/[^\d]/g, "");
}

export function buildWhatsAppDeepLink(code: string): string {
  const phone = getWhatsAppBusinessPhoneE164();
  const text = encodeURIComponent(buildReferralWhatsAppPrefill(code));
  if (phone) {
    return `https://wa.me/${phone}?text=${text}`;
  }
  return `https://wa.me/?text=${text}`;
}
