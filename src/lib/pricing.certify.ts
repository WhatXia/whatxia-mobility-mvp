/**
 * Certificación pricing compat — Ibagué v2 (delega a @/lib/tariff).
 */
export {};

import { calculateFareWithRules, formatFareCop } from "@/lib/pricing/engine";
import type { FareRules } from "@/lib/pricing/types";
import {
  distanceIncrementUnits,
  isNightTime,
  isSundayOrHoliday,
} from "@/lib/pricing/surcharges";
import { roundTariffToHundred } from "@/lib/tariff/calculator";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

/** Fixture Ibagué v2. */
const RULES: FareRules = {
  id: "certify",
  currency: "COP",
  flagDrop: 4500,
  minimumFare: 6600,
  minDistanceMeters: 1600,
  incrementMeters: 80,
  incrementAmount: 90,
  waitSeconds: 40,
  waitAmount: 90,
  surchargeNight: 1000,
  surchargeSundayHoliday: 850,
  surchargeAirport: 6500,
  surchargeWhatxia: 800,
  nightStartHour: 19,
  nightEndHour: 6,
  holidayDates: ["2026-01-01"],
  airportKeywords: ["aeropuerto"],
  airportCenterLat: 3.5583,
  airportCenterLng: -76.3817,
  airportRadiusMeters: 2500,
};

const short = calculateFareWithRules(
  { distanceMeters: 800, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00") },
);
assert(short.breakdown.officialFare === 6600, "800 m: oficial 6600");
assert(short.breakdown.surchargeWhatxia === 800, "WhatXia 800");
assert(short.amount === 7400, "800 m: total 7400");
assert(short.breakdown.minimumApplied === true, "800 m: mínima");

assert(
  calculateFareWithRules(
    { distanceMeters: 1600, durationSeconds: 120 },
    RULES,
    { at: new Date("2026-07-21T10:00:00") },
  ).amount === 7400,
  "1.600 m: 7400",
);

const d1680 = calculateFareWithRules(
  { distanceMeters: 1680, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(d1680.amount === 7490, "1.680 m: exacto 7490");
assert(roundTariffToHundred(d1680.amount) === 7500, "1.680 m: mostrar 7500");

const d2000 = calculateFareWithRules(
  { distanceMeters: 2000, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(d2000.amount === 7850, "2.000 m: exacto 7850");
assert(roundTariffToHundred(d2000.amount) === 7900, "2.000 m: mostrar 7900");

assert(
  distanceIncrementUnits(3200, RULES) === 20,
  "3.200 m: 20 incrementos",
);
assert(
  calculateFareWithRules(
    { distanceMeters: 3200, durationSeconds: 300 },
    RULES,
    { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
  ).amount === 9200,
  "3.200 m: 9200",
);

const withWait = calculateFareWithRules(
  { distanceMeters: 1000, durationSeconds: 60 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 80 },
);
assert(withWait.breakdown.waitComponent === 180, "Espera 80s → 180");

assert(
  isNightTime(new Date("2026-07-21T19:00:00"), RULES),
  "19:00 es nocturno",
);
assert(
  !isNightTime(new Date("2026-07-21T06:00:00"), RULES),
  "06:00 no es nocturno",
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
  formatFareCop(7490).includes("7.500") || formatFareCop(7490).includes("7500"),
  "formatFareCop redondea",
);

console.log("\npricing certify (Ibagué v2): OK");
