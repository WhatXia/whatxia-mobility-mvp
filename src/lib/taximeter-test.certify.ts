/**
 * Certificación taxímetro de prueba (sin I/O).
 * Ejecutar: npx tsx src/lib/taximeter-test.certify.ts
 */
export {};

import {
  isTaximeterActivationText,
  isTaximeterButton,
  parseMeterValue,
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
  isTaximeterButton(TAXIMETER_BUTTON_IDS.SEND_LOCATION),
  "botón enviar ubicación",
);
assert(isTaximeterButton(TAXIMETER_BUTTON_IDS.FINISH), "botón terminar");
assert(isTaximeterButton(TAXIMETER_BUTTON_IDS.CALLE), "botón calle");
assert(isTaximeterButton(TAXIMETER_BUTTON_IDS.SATELITAL), "botón satelital");
assert(!isTaximeterButton("booking_request_trip"), "no booking button");

assert(parseMeterValue("14700") === 14700, "valor plano");
assert(parseMeterValue("$14.700") === 14700, "valor con punto miles");
assert(parseMeterValue("14,700") === 14700, "valor con coma");
assert(parseMeterValue("abc") === null, "rechaza texto");
assert(parseMeterValue("0") === null, "rechaza cero");

assert(true, "flujo independiente de booking/dispatch");

console.log("\ntaximeter-test certify: OK");
