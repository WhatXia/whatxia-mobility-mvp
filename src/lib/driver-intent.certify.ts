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
assert(isDriverIntent("Soy conductor"), "soy conductor");
assert(isDriverIntent("Quiero ser conductor"), "quiero ser conductor");
assert(isDriverIntent("Conductor"), "conductor");
assert(isDriverIntent("Trabajar como conductor"), "trabajar como conductor");
assert(isDriverIntent("modo conductor"), "modo conductor");
assert(isDriverIntent("  ser conductor  "), "trim ser conductor");

assert(!isDriverIntent("hola"), "no hola");
assert(!isDriverIntent("necesito un taxi"), "no booking taxi");
assert(!isDriverIntent("solicitar servicio"), "no solicitar servicio");
assert(!isDriverIntent(null), "null");

console.log("\ndriver-intent certify: OK");
