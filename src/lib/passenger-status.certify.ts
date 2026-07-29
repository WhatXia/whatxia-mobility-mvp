/**
 * Certificación USER-001 (sin I/O).
 * Ejecutar: npx tsx src/lib/passenger-status.certify.ts
 */

import {
  canPassengerRequestService,
  defaultStatusForNewPassenger,
  isPassengerStatus,
  isPreLaunchMode,
} from "./passenger-status";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

assert(isPassengerStatus("PIONEER"), "PIONEER válido");
assert(isPassengerStatus("BETA"), "BETA válido");
assert(isPassengerStatus("ACTIVE"), "ACTIVE válido");
assert(isPassengerStatus("BLOCKED"), "BLOCKED válido");
assert(!isPassengerStatus("PENDING"), "PENDING inválido");

assert(canPassengerRequestService("ACTIVE"), "ACTIVE puede pedir");
assert(canPassengerRequestService("BETA"), "BETA puede pedir");
assert(!canPassengerRequestService("PIONEER"), "PIONEER no puede pedir");
assert(!canPassengerRequestService("BLOCKED"), "BLOCKED no puede pedir");

const prev = process.env.PRE_LAUNCH_MODE;
process.env.PRE_LAUNCH_MODE = "true";
assert(isPreLaunchMode() === true, "flag true");
assert(defaultStatusForNewPassenger() === "PIONEER", "nuevo → PIONEER");
process.env.PRE_LAUNCH_MODE = "false";
assert(isPreLaunchMode() === false, "flag false");
assert(defaultStatusForNewPassenger() === "ACTIVE", "nuevo → ACTIVE");
if (prev === undefined) {
  delete process.env.PRE_LAUNCH_MODE;
} else {
  process.env.PRE_LAUNCH_MODE = prev;
}

console.log("passenger-status.certify: OK");
