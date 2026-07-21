/**
 * Certificación Sprint 25 – motor de tarifas WhatXia.
 * Ejecutar: npx tsx src/lib/pricing.certify.ts
 *
 * Usa reglas inyectadas (fixture) equivalentes al seed de fare_rules;
 * en producción los valores salen solo de la tabla.
 */
export {};

import { calculateFareWithRules, formatFareCop } from "@/lib/pricing/engine";
import type { FareRules } from "@/lib/pricing/types";
import {
  distanceIncrementUnits,
  isNightTime,
  isSundayOrHoliday,
} from "@/lib/pricing/surcharges";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

/** Fixture = valores seed de 015_fare_rules.sql (solo para certify). */
const RULES: FareRules = {
  id: "certify",
  currency: "COP",
  flagDrop: 4500,
  minimumFare: 6600,
  minDistanceMeters: 1600,
  incrementMeters: 60,
  incrementAmount: 105,
  waitSeconds: 40,
  waitAmount: 90,
  surchargeNight: 1000,
  surchargeSundayHoliday: 1000,
  surchargeAirport: 6500,
  surchargeWhatxia: 1000,
  nightStartHour: 20,
  nightEndHour: 5,
  holidayDates: ["2026-01-01"],
  airportKeywords: ["aeropuerto"],
  airportCenterLat: 3.5583,
  airportCenterLng: -76.3817,
  airportRadiusMeters: 2500,
};

// Viaje muy corto → oficial mínima 6600 + WhatXia 1000 = 7600
const short = calculateFareWithRules(
  { distanceMeters: 500, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00") }, // martes día
);
assert(short.breakdown.officialFare === 6600, "Corto: tarifa oficial 6600");
assert(short.breakdown.surchargeWhatxia === 1000, "Corto: WhatXia 1000");
assert(short.amount === 7600, "Corto: total 7600");
assert(short.breakdown.minimumApplied === true, "Corto: mínimo aplicado");

// Distancia con 47 incrementos: 4500 + 47*105 = 9435 (+ WhatXia → 10435)
// (El ejemplo comercial “9450” ilustra la forma official + 1000.)
assert(
  distanceIncrementUnits(4420, RULES) === 47,
  "47 incrementos a 4420 m",
);
const mid = calculateFareWithRules(
  { distanceMeters: 4420, durationSeconds: 600 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(mid.breakdown.officialRaw === 9435, "Calcula 9435 oficial raw");
assert(mid.breakdown.officialFare === 9435, "Sin mínimo (9435 > 6600)");
assert(mid.breakdown.surchargeWhatxia === 1000, "WhatXia 1000");
assert(mid.amount === 10435, "Total = oficial + WhatXia");

// Espera: 80s → 2*90 = 180
const withWait = calculateFareWithRules(
  { distanceMeters: 1000, durationSeconds: 60 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 80 },
);
assert(withWait.breakdown.waitComponent === 180, "Espera 80s → 180");
assert(
  withWait.breakdown.officialFare === 6600,
  "Con espera corta aún aplica mínimo si raw < 6600",
);

// Nocturno
assert(
  isNightTime(new Date("2026-07-21T21:00:00"), RULES),
  "21:00 es nocturno",
);
assert(
  !isNightTime(new Date("2026-07-21T10:00:00"), RULES),
  "10:00 no es nocturno",
);
const night = calculateFareWithRules(
  { distanceMeters: 500, durationSeconds: 60 },
  RULES,
  { at: new Date("2026-07-21T21:30:00") },
);
assert(night.breakdown.surchargeNight === 1000, "Recargo nocturno 1000");
assert(night.amount === 8600, "Corto nocturno 6600+1000+1000 WhatXia");

// Domingo
assert(
  isSundayOrHoliday(new Date("2026-07-19T12:00:00"), RULES),
  "Domingo detectado",
);
assert(
  isSundayOrHoliday(new Date("2026-01-01T12:00:00"), RULES),
  "Festivo en lista",
);

// Aeropuerto por keyword
const airport = calculateFareWithRules(
  { distanceMeters: 500, durationSeconds: 60 },
  RULES,
  {
    at: new Date("2026-07-21T10:00:00"),
    dropoffLabel: "Aeropuerto Alfonso Bonilla",
  },
);
assert(airport.breakdown.surchargeAirport === 6500, "Recargo aeropuerto");
assert(
  airport.amount === 6600 + 6500 + 1000,
  "Corto + aeropuerto + WhatXia",
);

assert(
  formatFareCop(7600).includes("7.600") || formatFareCop(7600).includes("7600"),
  "formatFareCop",
);

console.log("\nSprint 25 pricing: todas las aserciones OK");
