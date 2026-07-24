/**
 * Certificación pricing compat — estimado MVP sin recargo por llamada.
 */
export {};

import { calculateFareWithRules, formatFareCop } from "@/lib/pricing/engine";
import type { FareRules } from "@/lib/pricing/types";
import {
  distanceIncrementUnits,
  isNightTime,
  isSundayOrHoliday,
} from "@/lib/pricing/surcharges";
import {
  calculateTariff,
  roundTariffToHundred,
} from "@/lib/tariff/calculator";
import { mapFareRulesRowToCityTariff } from "@/lib/tariff/config-loader";

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
assert(short.breakdown.surchargeWhatxia === 0, "estimado: WhatXia 0 (MVP)");
assert(short.amount === 6600, "800 m estimado: total 6600");
assert(short.breakdown.minimumApplied === true, "800 m: mínima");

assert(
  calculateFareWithRules(
    { distanceMeters: 1600, durationSeconds: 120 },
    RULES,
    { at: new Date("2026-07-21T10:00:00") },
  ).amount === 6600,
  "1.600 m estimado: 6600",
);

const d1680 = calculateFareWithRules(
  { distanceMeters: 1680, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(d1680.amount === 6690, "1.680 m estimado: 6690");
assert(roundTariffToHundred(d1680.amount) === 6700, "1.680 m: mostrar 6700");

const d2000 = calculateFareWithRules(
  { distanceMeters: 2000, durationSeconds: 120 },
  RULES,
  { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
);
assert(d2000.amount === 7050, "2.000 m estimado: 7050");

assert(
  distanceIncrementUnits(3200, RULES) === 20,
  "3.200 m: 20 incrementos",
);
assert(
  calculateFareWithRules(
    { distanceMeters: 3200, durationSeconds: 300 },
    RULES,
    { at: new Date("2026-07-21T10:00:00"), waitSeconds: 0 },
  ).amount === 8400,
  "3.200 m estimado: 8400",
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
assert(night.amount === 7600, "Corto nocturno estimado 6600+1000");

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
assert(airport.amount === 6600 + 6500, "Corto + aeropuerto (sin llamada)");

// Final sigue aplicando el recargo (regla no eliminada)
const cfg = mapFareRulesRowToCityTariff({
  id: "certify-row",
  currency: "COP",
  flag_drop: RULES.flagDrop,
  minimum_fare: RULES.minimumFare,
  min_distance_meters: RULES.minDistanceMeters,
  increment_meters: RULES.incrementMeters,
  increment_amount: RULES.incrementAmount,
  wait_seconds: RULES.waitSeconds,
  wait_amount: RULES.waitAmount,
  time_unit_seconds: 0,
  time_amount: 0,
  wait_speed_threshold_kmh: 5,
  surcharge_night: RULES.surchargeNight,
  surcharge_sunday_holiday: RULES.surchargeSundayHoliday,
  surcharge_airport: RULES.surchargeAirport,
  surcharge_whatxia: RULES.surchargeWhatxia,
  night_start_hour: RULES.nightStartHour,
  night_end_hour: RULES.nightEndHour,
  holiday_dates: [],
  airport_keywords: RULES.airportKeywords,
  airport_center_lat: RULES.airportCenterLat,
  airport_center_lng: RULES.airportCenterLng,
  airport_radius_meters: RULES.airportRadiusMeters,
  cities: { slug: "ibague", name: "Ibagué", country_code: "CO" },
});
const finalShort = calculateTariff({
  kind: "final",
  config: cfg,
  distanceMeters: 800,
  durationSeconds: 120,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  isPublicHoliday: false,
  provider: "certify",
});
assert(finalShort.amount === 7400, "final: 7400 con llamada");
assert(finalShort.breakdown.surchargePlatform === 800, "final: platform 800");

assert(
  formatFareCop(6690).includes("6.700") || formatFareCop(6690).includes("6700"),
  "formatFareCop redondea",
);

console.log("\npricing certify (estimado sin llamada): OK");
