/**
 * Certificación rápida de reglas documentales (Sprint 17).
 * Ejecutar: npx tsx src/lib/driver-documents.certify.ts
 */
import {
  daysUntilExpiry,
  getExpiredDocuments,
  getReminderTargets,
  hasExpiredDocuments,
  isDocumentExpired,
} from "@/lib/driver-documents";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const today = "2026-07-21";

assert(!isDocumentExpired("2026-07-21", today), "Vigente el mismo día de vencimiento");
assert(isDocumentExpired("2026-07-20", today), "Vencido desde el día siguiente");
assert(!hasExpiredDocuments({
  soat_expires_at: "2026-07-21",
  techno_expires_at: "2026-08-01",
  license_expires_at: "2026-09-01",
}, today), "Registro con documentos vigentes");
assert(hasExpiredDocuments({
  soat_expires_at: "2026-07-20",
  techno_expires_at: "2026-08-01",
  license_expires_at: "2026-09-01",
}, today), "Registro con documento vencido");
assert(
  getExpiredDocuments({
    soat_expires_at: "2026-07-20",
    techno_expires_at: "2026-07-21",
    license_expires_at: "2026-07-19",
  }, today).join(",") === "soat,license",
  "Solo marca documentos realmente vencidos",
);
assert(daysUntilExpiry("2026-08-20", today) === 30, "Recordatorio 30 días");
assert(daysUntilExpiry("2026-08-05", today) === 15, "Recordatorio 15 días");
assert(daysUntilExpiry("2026-07-28", today) === 7, "Recordatorio 7 días");
assert(daysUntilExpiry("2026-07-22", today) === 1, "Recordatorio 1 día");

const reminders = getReminderTargets({
  soat_expires_at: "2026-08-20",
  techno_expires_at: "2026-07-28",
  license_expires_at: "2026-07-22",
}, today);

assert(
  reminders.some((r) => r.type === "soat" && r.daysBefore === 30),
  "Target SOAT a 30 días",
);
assert(
  reminders.some((r) => r.type === "techno" && r.daysBefore === 7),
  "Target tecnomecánica a 7 días",
);
assert(
  reminders.some((r) => r.type === "license" && r.daysBefore === 1),
  "Target licencia a 1 día",
);

console.log("\nCertificación de reglas documentales: PASS");
