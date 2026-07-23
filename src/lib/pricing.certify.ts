/**
 * Certificación pricing compat — fixture = tarifas oficiales Ibagué (022).
 * En producción los valores salen solo de fare_rules.
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

/** Fixture alineado a migración 022 (oficial Ibagué). */
const RULES: FareRules = {
  id: "certify",
  currency: "COP",
  flagDrop: 4500,
  minimumFare: 6600,
  minDistanceMeters: 1600,
  incrementMeters: 80,
  incrementAmount: 105,
  waitSeconds: 40,
  waitAmount: 90,
  surchargeNight: 1000,
  surchargeSundayHoliday: 850,
  surchargeAirport: 6500,
  surchargeWhatxia: 800,
  nightStartHour: 20,
  nightEndHour: 5,
  holidayDates: ["2026-01-01"],
  airportKeywords: ["aeropuerto"],
  airportCenterLat: 3.5583,
  airportCenterLng: -76.3817,
  airportRadiusMeters: 2500,
};

const short = calculateFareWithRules(
  { distanceMeters: 500, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00") },
);
assert(short.breakdown.officialFare === 6600, "Corto: tarifa oficial 6600");
assert(short.breakdown.surchargeWhatxia === 800, "Corto: WhatXia 800");
assert(short.amount === 7400, "Corto: total 7400");
assert(short.breakdown.minimumApplied === true, "Corto: mínimo aplicado");

assert(
  distanceIncrementUnits(4400, RULES) === 35,
  "35 incrementos a 4400 m (tick 80 m)",
);
const mid = calculateFareWithRules(
  { distanceMeters: 4400, durationSeconds: 600 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(mid.breakdown.officialRaw === 8175, "Calcula 8175 oficial raw");
assert(mid.breakdown.surchargeWhatxia === 800, "WhatXia 800");
assert(mid.amount === 8975, "Total = oficial + WhatXia 800");

const withWait = calculateFareWithRules(
  { distanceMeters: 1000, durationSeconds: 60 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 80 },
);
assert(withWait.breakdown.waitComponent === 180, "Espera 80s → 180");

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
assert(night.amount === 8400, "Corto nocturno 6600+1000+800");

assert(
  isSundayOrHoliday(new Date("2026-07-19T12:00:00"), RULES),
  "Domingo detectado",
);
assert(
  isSundayOrHoliday(new Date("2026-01-01T12:00:00"), RULES),
  "Festivo en lista",
);

const airport = calculateFareWithRules(
  { distanceMeters: 500, durationSeconds: 60 },
  RULES,
  {
    at: new Date("2026-07-21T10:00:00"),
    dropoffLabel: "Aeropuerto Alfonso Bonilla",
  },
);
assert(airport.breakdown.surchargeAirport === 6500, "Recargo aeropuerto");
assert(airport.amount === 6600 + 6500 + 800, "Corto + aeropuerto + WhatXia");

assert(
  formatFareCop(7400).includes("7.400") || formatFareCop(7400).includes("7400"),
  "formatFareCop",
);

console.log("\npricing certify (tarifas oficiales): OK");
