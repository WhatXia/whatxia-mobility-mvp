/**
 * Certificación REF-003 / REF-004 / REF-005 (sin I/O de red/DB).
 * Ejecutar: npm run test:referrals
 */

import {
  buildReferralCopyMessage,
  buildReferralShareMessage,
} from "./referrals/bot";
import {
  buildLegacyWebReferralLink,
  buildReferralLink,
  buildReferralWhatsAppPrefill,
  buildWhatsAppDeepLink,
  extractReferralCodeFromText,
  generateReferralCode,
  getWhatsAppBusinessPhoneE164,
  isReferralOnlyMessage,
  isValidReferralCodeFormat,
  normalizeReferralCode,
  REFERRAL_CODE_PATTERN,
  WHATXIA_OFFICIAL_WHATSAPP_E164,
} from "./referrals/codes";
import {
  computeReferralConversionPercent,
  isActiveReferrerDriver,
} from "./referrals";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

assert(isValidReferralCodeFormat("DRV-AB23C"), "formato válido");
assert(isValidReferralCodeFormat("drv-ab23c"), "formato case-insensitive");
assert(!isValidReferralCodeFormat("DRV-ABC"), "formato corto inválido");
assert(!isValidReferralCodeFormat("ABC-12345"), "prefijo inválido");
assert(!isValidReferralCodeFormat("DRV-OI0II"), "letras ambiguas inválidas");

assert(normalizeReferralCode(" drv-ab23c ") === "DRV-AB23C", "normalize");

const generated = generateReferralCode(() => 0);
assert(/^DRV-[A-HJ-NP-Z2-9]{5}$/.test(generated), "generateReferralCode forma");
assert(generated === "DRV-AAAAA", "generateReferralCode determinista con rng=0");

assert(
  extractReferralCodeFromText("REF DRV-AB23C") === "DRV-AB23C",
  "extract con prefijo REF",
);
assert(
  extractReferralCodeFromText("Hola DRV-XY34Z amigos") === "DRV-XY34Z",
  "extract embebido",
);
assert(extractReferralCodeFromText("hola") === null, "extract sin código");
assert(REFERRAL_CODE_PATTERN.test("DRV-AB23C"), "pattern match");

assert(isReferralOnlyMessage("DRV-AB23C"), "solo código");
assert(isReferralOnlyMessage("REF DRV-AB23C"), "solo REF + código");
assert(isReferralOnlyMessage("ref drv-ab23c"), "solo REF casefold");
assert(!isReferralOnlyMessage("Hola REF DRV-AB23C"), "texto extra → no only");

const prevPhone = process.env.WHATSAPP_BUSINESS_PHONE;
const prevPublic = process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
const prevBase = process.env.REFERRAL_PUBLIC_BASE_URL;
const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
delete process.env.WHATSAPP_BUSINESS_PHONE;
delete process.env.NEXT_PUBLIC_WHATSAPP_PHONE;

assert(
  WHATXIA_OFFICIAL_WHATSAPP_E164 === "573193455555",
  "número oficial WhatXia",
);
assert(
  getWhatsAppBusinessPhoneE164() === "573193455555",
  "default teléfono oficial",
);

const expectedLink =
  "https://wa.me/573193455555?text=" + encodeURIComponent("REF DRV-AB23C");
assert(buildReferralLink("drv-ab23c") === expectedLink, "buildReferralLink wa.me");
assert(
  buildWhatsAppDeepLink("DRV-AB23C") === expectedLink,
  "buildWhatsAppDeepLink = canónico",
);
assert(
  buildReferralWhatsAppPrefill("drv-ab23c") === "REF DRV-AB23C",
  "wa prefill",
);

process.env.WHATSAPP_BUSINESS_PHONE = "+57 300 123 4567";
assert(
  buildReferralLink("DRV-AB23C").startsWith("https://wa.me/573001234567?text="),
  "override env teléfono",
);

process.env.REFERRAL_PUBLIC_BASE_URL = "https://whatxia.com";
assert(
  buildLegacyWebReferralLink("DRV-AB23C") ===
    "https://whatxia.com/r/DRV-AB23C",
  "landing legada /r solo compat",
);

if (prevPhone === undefined) delete process.env.WHATSAPP_BUSINESS_PHONE;
else process.env.WHATSAPP_BUSINESS_PHONE = prevPhone;
if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_PHONE;
else process.env.NEXT_PUBLIC_WHATSAPP_PHONE = prevPublic;
if (prevBase === undefined) delete process.env.REFERRAL_PUBLIC_BASE_URL;
else process.env.REFERRAL_PUBLIC_BASE_URL = prevBase;
if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
else process.env.NEXT_PUBLIC_SITE_URL = prevSite;

assert(
  isActiveReferrerDriver({ status: "active", documents_blocked: false }),
  "referrer activo",
);
assert(
  !isActiveReferrerDriver({ status: "inactive", documents_blocked: false }),
  "referrer inactive / deshabilitado",
);
assert(
  !isActiveReferrerDriver({ status: "active", documents_blocked: true }),
  "referrer docs bloqueados",
);
assert(!isActiveReferrerDriver(null), "referrer null");

assert(computeReferralConversionPercent(0, 0) === 0, "conv 0/0 → 0");
assert(computeReferralConversionPercent(5, 0) === 0, "conv sin clics → 0");
assert(computeReferralConversionPercent(1, 4) === 25, "conv 1/4 → 25%");
assert(computeReferralConversionPercent(1, 3) === 33.3, "conv 1/3 → 33.3%");

const share = buildReferralShareMessage({
  code: "DRV-A8F2K",
  link: "https://wa.me/573193455555?text=REF%20DRV-A8F2K",
  totalReferrals: 3,
});
assert(share.includes("Programa de Referidos"), "copy título");
assert(share.includes("wa.me/573193455555"), "copy enlace wa.me");
assert(share.includes("🔗 Tu enlace:"), "copy label enlace");
assert(share.includes("🏷️ Tu código: DRV-A8F2K"), "copy código");
assert(share.includes("Referidos registrados: 3"), "copy stats");

const copyMsg = buildReferralCopyMessage(
  "DRV-A8F2K",
  "https://wa.me/573193455555?text=REF%20DRV-A8F2K",
);
assert(copyMsg.includes("Copia tu enlace"), "copy CTA texto");
assert(copyMsg.includes("wa.me/573193455555"), "copy CTA link wa.me");

assert(
  !isActiveReferrerDriver({ status: "inactive", documents_blocked: false }),
  "escenario: código deshabilitado (driver inactive)",
);
assert(
  !isValidReferralCodeFormat("DRV-ZZZZ"),
  "escenario: código inexistente / formato inválido",
);

console.log("referrals.certify: OK");
