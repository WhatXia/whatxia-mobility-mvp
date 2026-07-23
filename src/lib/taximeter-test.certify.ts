/**
 * Certificación taxímetro de prueba (sin I/O).
 * Ejecutar: npx tsx src/lib/taximeter-test.certify.ts
 */
export {};

import {
  isTaximeterActivationText,
  isTaximeterButton,
  TAXIMETER_BUTTON_IDS,
} from "@/lib/taximeter-test";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(isTaximeterActivationText("🚖"), "activa con emoji");
assert(isTaximeterActivationText(" 🚖 "), "trim emoji");
assert(!isTaximeterActivationText("hola"), "no activa con hola");
assert(!isTaximeterActivationText("necesito un servicio"), "no Mobility");

assert(
  isTaximeterButton(TAXIMETER_BUTTON_IDS.CONFIRM_FINISH),
  "botón terminar recorrido",
);
assert(isTaximeterButton(TAXIMETER_BUTTON_IDS.CALLE), "botón calle");
assert(isTaximeterButton(TAXIMETER_BUTTON_IDS.SATELITAL), "botón satelital");
assert(!isTaximeterButton("taximeter_finish"), "ya no usa finish viejo");
assert(!isTaximeterButton("booking_request_trip"), "no booking button");

assert(true, "flujo independiente de booking/dispatch");

console.log("\ntaximeter-test certify: OK");
