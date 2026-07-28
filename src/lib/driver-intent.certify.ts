/**
 * Certificación detección módulo conductor (sin I/O).
 * Ejecutar: npx tsx src/lib/driver-intent.certify.ts
 */
export {};

import { isDriverIntent } from "@/lib/whatsapp/handler";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(isDriverIntent("🚖"), "emoji taxi");
assert(isDriverIntent("🚕"), "emoji taxi clasico");
assert(isDriverIntent(" 🚖 "), "trim emoji");
assert(isDriverIntent("🚖\uFE0F"), "emoji + VS16");
assert(isDriverIntent("🚕\uFE0F"), "taxi clasico + VS16");
assert(isDriverIntent("🚖 hola"), "emoji + texto");
assert(isDriverIntent("🚖  hola mundo"), "emoji + espacios + texto");
assert(isDriverIntent("Soy conductor"), "soy conductor");
assert(isDriverIntent("Quiero ser conductor"), "quiero ser conductor");
assert(isDriverIntent("Conductor"), "conductor");
assert(isDriverIntent("Trabajar como conductor"), "trabajar como conductor");
assert(isDriverIntent("modo conductor"), "modo conductor");
assert(isDriverIntent("  ser conductor  "), "trim ser conductor");

assert(!isDriverIntent("hola"), "no hola");
assert(!isDriverIntent("necesito un taxi"), "no booking taxi");
assert(!isDriverIntent("solicitar servicio"), "no solicitar servicio");
assert(!isDriverIntent("hola 🚖"), "no emoji al final");
assert(!isDriverIntent(null), "null");

console.log("\ndriver-intent certify: OK");
