/**
 * Certificación Sprint 23 – parseo Routes API.
 * Ejecutar: npx tsx src/lib/routes-map.certify.ts
 */
export {};

import { parseRoutesResponse } from "@/lib/geo/routes";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const estimate = parseRoutesResponse({
  routes: [
    {
      distanceMeters: 4250,
      duration: "780s",
      polyline: { encodedPolyline: "abc" },
    },
  ],
});

assert(estimate.distanceMeters === 4250, "distanceMeters desde fixture");
assert(estimate.durationSeconds === 780, "durationSeconds parsea 780s");
assert(estimate.polylineEncoded === "abc", "polyline opcional");

const fractional = parseRoutesResponse({
  routes: [{ distanceMeters: 100, duration: "90.7s" }],
});
assert(fractional.durationSeconds === 91, "duration redondea 90.7s → 91");

let threw = false;
try {
  parseRoutesResponse({ routes: [] });
} catch {
  threw = true;
}
assert(threw, "Sin rutas → error");

console.log("\nSprint 23 routes-map: todas las aserciones OK");
