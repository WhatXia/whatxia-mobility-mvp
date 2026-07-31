/**
 * Certificación USER-001 estados (sin I/O).
 * El programa Pioneros (CFG-001) se valida en runtime contra launch_programs.
 * Ejecutar: npx tsx src/lib/passenger-status.certify.ts
 */

import {
  canPassengerRequestService,
  isPassengerStatus,
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

console.log("passenger-status.certify: OK (estados)");
console.log(
  "Nota CFG-001: isPreLaunchMode/defaultStatusForNewPassenger leen launch_programs en DB.",
);
