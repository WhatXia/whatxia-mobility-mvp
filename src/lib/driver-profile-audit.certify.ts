/**
 * Certificación DRIVER-004.1 (sin I/O).
 * Ejecutar: npx tsx src/lib/driver-profile-audit.certify.ts
 */

import {
  evaluatePhoneChangeCooldown,
  formatPhoneChangeAvailableDate,
  PHONE_CHANGE_COOLDOWN_DAYS,
} from "./driver-profile-audit";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

assert(PHONE_CHANGE_COOLDOWN_DAYS === 30, "cooldown 30 días");

assert(
  evaluatePhoneChangeCooldown(null).allowed === true,
  "sin historial → permitir",
);

const now = new Date("2026-07-27T12:00:00.000Z");
const recent = new Date("2026-07-10T12:00:00.000Z");
const blocked = evaluatePhoneChangeCooldown(recent, now);
assert(blocked.allowed === false, "cambio reciente → bloquear");
if (!blocked.allowed) {
  assert(
    formatPhoneChangeAvailableDate(blocked.nextAvailableAt) === "09/08/2026",
    "próxima fecha = +30 días UTC",
  );
}

const old = new Date("2026-06-20T12:00:00.000Z");
assert(
  evaluatePhoneChangeCooldown(old, now).allowed === true,
  "≥30 días → permitir",
);

console.log("driver-profile-audit.certify: OK");
