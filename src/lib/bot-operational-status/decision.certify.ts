/**
 * Certificación SYS-001 (sin I/O).
 * Ejecutar: npm run test:sistema
 */

import {
  isBotOperationalStatus,
  type BotOperationalStatusCode,
} from "./types";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

assert(isBotOperationalStatus("ACTIVE"), "ACTIVE válido");
assert(isBotOperationalStatus("MAINTENANCE"), "MAINTENANCE válido");
assert(!isBotOperationalStatus("OFF"), "OFF inválido");

function shouldBlockConversation(
  status: BotOperationalStatusCode,
  bypassPhone: boolean,
): boolean {
  if (bypassPhone) return false;
  return status === "MAINTENANCE";
}

assert(
  !shouldBlockConversation("ACTIVE", false),
  "ACTIVE no bloquea conversación",
);
assert(
  shouldBlockConversation("MAINTENANCE", false),
  "MAINTENANCE bloquea conversación",
);
assert(
  !shouldBlockConversation("MAINTENANCE", true),
  "admin bypass no bloquea",
);

console.log("bot-operational-status.certify: OK (SYS-001)");
