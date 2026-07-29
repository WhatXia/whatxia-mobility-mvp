/**
 * Certificación REF-003 / REF-004 (sin I/O de red/DB).
 * Ejecutar: npm run test:referrals
 */

import {
  buildReferralCopyMessage,
  buildReferralShareMessage,
} from "./referrals/bot";
import {
  buildReferralLink,
  buildReferralWhatsAppPrefill,
  buildWhatsAppDeepLink,
  extractReferralCodeFromText,
  generateReferralCode,
  isReferralOnlyMessage,
  isValidReferralCodeFormat,
  normalizeReferralCode,
  REFERRAL_CODE_PATTERN,
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

const prevBase = process.env.REFERRAL_PUBLIC_BASE_URL;
const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
const prevPhone = process.env.WHATSAPP_BUSINESS_PHONE;
process.env.REFERRAL_PUBLIC_BASE_URL = "https://whatxia.com";
delete process.env.NEXT_PUBLIC_SITE_URL;
process.env.WHATSAPP_BUSINESS_PHONE = "+57 300 123 4567";

assert(
  buildReferralLink("drv-ab23c") === "https://whatxia.com/r/DRV-AB23C",
  "buildReferralLink",
);
assert(
  buildReferralWhatsAppPrefill("drv-ab23c") === "REF DRV-AB23C",
  "wa prefill",
);
assert(
  buildWhatsAppDeepLink("DRV-AB23C").startsWith(
    "https://wa.me/573001234567?text=",
  ),
  "wa deep link con teléfono",
);

if (prevBase === undefined) delete process.env.REFERRAL_PUBLIC_BASE_URL;
else process.env.REFERRAL_PUBLIC_BASE_URL = prevBase;
if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
if (prevPhone === undefined) delete process.env.WHATSAPP_BUSINESS_PHONE;
else process.env.WHATSAPP_BUSINESS_PHONE = prevPhone;

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
  code: "DRV-AB23C",
  link: "https://whatxia.com/r/DRV-AB23C",
  totalReferrals: 3,
});
assert(share.includes("Programa de Referidos"), "copy título");
assert(share.includes("https://whatxia.com/r/DRV-AB23C"), "copy enlace");
assert(share.includes("🔗 Tu enlace:"), "copy label enlace");
assert(share.includes("🏷️ Tu código: DRV-AB23C"), "copy código");
assert(share.includes("Referidos registrados: 3"), "copy stats");

const copyMsg = buildReferralCopyMessage(
  "DRV-AB23C",
  "https://whatxia.com/r/DRV-AB23C",
);
assert(copyMsg.includes("Copia tu enlace"), "copy CTA texto");
assert(copyMsg.includes("https://whatxia.com/r/DRV-AB23C"), "copy CTA link");

// Escenarios REF-004 (reglas puras documentadas en certify)
assert(
  !isActiveReferrerDriver({ status: "inactive", documents_blocked: false }),
  "escenario: código deshabilitado (driver inactive)",
);
assert(
  !isValidReferralCodeFormat("DRV-ZZZZ"),
  "escenario: código inexistente / formato inválido",
);

console.log("referrals.certify: OK");
