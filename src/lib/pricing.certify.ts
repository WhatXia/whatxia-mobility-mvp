/**
 * Certificación Sprint 23 – motor de tarifas WhatXia.
 * Ejecutar: npx tsx src/lib/pricing.certify.ts
 */
export {};

import { calculateFare, formatFareCop } from "@/lib/pricing/engine";
import { roundToHundreds, type PricingConfig } from "@/lib/pricing/config";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const config: PricingConfig = {
  baseFare: 3000,
  perKm: 1200,
  perMin: 200,
  minimumFare: 6000,
};

assert(roundToHundreds(6150) === 6200, "Redondeo a centenas (6150→6200)");
assert(roundToHundreds(6149) === 6100, "Redondeo a centenas (6149→6100)");

const short = calculateFare(
  { distanceMeters: 500, durationSeconds: 120 },
  config,
);
assert(short.amount === 6000, "Mínimo 6000 COP en trayecto corto");
assert(short.breakdown.minimumApplied === true, "minimumApplied en trayecto corto");
assert(short.currency === "COP", "Moneda COP");

const mid = calculateFare(
  { distanceMeters: 8000, durationSeconds: 1200 },
  config,
);
// raw = 3000 + 8*1200 + 20*200 = 3000+9600+4000 = 16600
assert(mid.amount === 16600, "Tarifa media 8km/20min = 16600");
assert(mid.breakdown.minimumApplied === false, "Sin mínimo en trayecto medio");
assert(mid.distanceKm === 8, "distanceKm 8.0");
assert(mid.durationMin === 20, "durationMin 20");
assert(
  mid.breakdown.base === 3000 &&
    mid.breakdown.distanceComponent === 9600 &&
    mid.breakdown.timeComponent === 4000,
  "Breakdown base+km+min",
);

assert(formatFareCop(6000).includes("6.000") || formatFareCop(6000).includes("6000"), "formatFareCop");

console.log("\nSprint 23 pricing: todas las aserciones OK");
