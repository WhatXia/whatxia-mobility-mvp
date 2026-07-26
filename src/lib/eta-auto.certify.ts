/**
 * Certificación Fase 1.1 — ETA automático.
 * Ejecutar: npx tsx src/lib/eta-auto.certify.ts
 */
export {};

import { computeAutomaticEtaRange } from "@/lib/eta-auto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const fast = computeAutomaticEtaRange(0);
assert(fast.minMinutes === 5 && fast.maxMinutes === 7, "0s → 5–7 min");

const at60 = computeAutomaticEtaRange(60);
assert(at60.minMinutes === 5 && at60.maxMinutes === 7, "60s → 5–7 min (≤60)");

const justOver = computeAutomaticEtaRange(60.001);
assert(
  justOver.minMinutes === 7 && justOver.maxMinutes === 10,
  ">60s → 7–10 min",
);

const slow = computeAutomaticEtaRange(180);
assert(slow.minMinutes === 7 && slow.maxMinutes === 10, "180s → 7–10 min");

console.log("Fase 1.1 ETA automático: certificación OK");
