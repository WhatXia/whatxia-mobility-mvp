/**
 * Certificación Tariff Engine — fare_rules + holidays (sin holiday_dates).
 * Ejecutar: npx tsx src/lib/tariff.certify.ts
 */
export {};

import {
  appliesSundayHolidaySurcharge,
  calculateTariff,
  distanceIncrementUnits,
  isNightTime,
} from "@/lib/tariff/calculator";
import {
  mapFareRulesRowToCityTariff,
  type FareRulesDbRow,
} from "@/lib/tariff/config-loader";
import { isSundayOrPublicHoliday } from "@/lib/tariff/holidays";
import { deriveWaitSecondsFromSpeed } from "@/lib/tariff/waiting";
import { tariffQuoteToFareQuote } from "@/lib/tariff/adapters";
import { LocalTariffProvider } from "@/lib/tariff/provider";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const fixtureRow: FareRulesDbRow = {
  id: "certify-row",
  currency: "COP",
  flag_drop: 4500,
  minimum_fare: 6600,
  min_distance_meters: 1600,
  increment_meters: 80,
  increment_amount: 105,
  wait_seconds: 40,
  wait_amount: 90,
  time_unit_seconds: 0,
  time_amount: 0,
  wait_speed_threshold_kmh: 5,
  surcharge_night: 1000,
  surcharge_sunday_holiday: 850,
  surcharge_airport: 6500,
  surcharge_whatxia: 800,
  night_start_hour: 19,
  night_end_hour: 6,
  holiday_dates: [],
  airport_keywords: ["aeropuerto", "perales"],
  airport_center_lat: 4.4214,
  airport_center_lng: -75.1333,
  airport_radius_meters: 2500,
  cities: { slug: "ibague", name: "Ibagué", country_code: "CO" },
};

const cfg = mapFareRulesRowToCityTariff(fixtureRow);
assert(cfg.countryCode === "CO", "Mapper: countryCode desde cities");
assert(cfg.holidayDates?.length === 0, "holiday_dates no se usa (vacío)");
assert(cfg.surcharges.sundayHoliday === 850, "Monto domingo/festivo en fare_rules");

const short = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 120,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  isPublicHoliday: false,
  provider: "certify",
});
assert(short.amount === 7400, "Corto: 6600+800");

assert(distanceIncrementUnits(4400, cfg) === 35, "35 ticks");
assert(
  calculateTariff({
    kind: "estimated",
    config: cfg,
    distanceMeters: 4400,
    durationSeconds: 600,
    waitSeconds: 0,
    waitSource: "none",
    at: new Date("2026-07-21T10:00:00"),
    isPublicHoliday: false,
    provider: "certify",
  }).amount === 8975,
  "Mid + plataforma",
);

assert(isNightTime(new Date("2026-07-21T19:00:00"), cfg), "19:00 nocturno");
assert(!isNightTime(new Date("2026-07-21T06:00:00"), cfg), "06:00 no nocturno");

assert(
  appliesSundayHolidaySurcharge(new Date("2026-07-19T12:00:00"), false),
  "Domingo aplica (sin festivo)",
);
assert(
  appliesSundayHolidaySurcharge(new Date("2026-01-01T12:00:00"), true),
  "Festivo (jueves) aplica vía flag holidays",
);
assert(
  appliesSundayHolidaySurcharge(new Date("2026-07-21T12:00:00"), false) ===
    false,
  "Martes no festivo no aplica",
);
assert(
  isSundayOrPublicHoliday(new Date("2026-12-25T10:00:00"), true),
  "Helper domingo|festivo",
);

const sunday = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 60,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-19T12:00:00"),
  isPublicHoliday: false,
  provider: "certify",
});
assert(sunday.breakdown.surchargeSundayHoliday === 850, "Recargo domingo 850");

const holidayWeekday = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 60,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-01-01T12:00:00"),
  isPublicHoliday: true,
  provider: "certify",
});
assert(
  holidayWeekday.breakdown.surchargeSundayHoliday === 850,
  "Festivo weekday: mismo recargo una vez",
);
assert(
  holidayWeekday.amount === 6600 + 850 + 800,
  "Festivo: mínima + 850 + 800",
);

// Domingo que también es “festivo” en tabla → una sola vez
const sundayHoliday = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 60,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-19T12:00:00"),
  isPublicHoliday: true,
  provider: "certify",
});
assert(
  sundayHoliday.breakdown.surchargeSundayHoliday === 850,
  "Domingo+festivo: recargo una sola vez",
);
assert(sundayHoliday.amount === sunday.amount, "Misma tarifa domingo±festivo");

assert(
  deriveWaitSecondsFromSpeed({
    distanceMeters: 100,
    durationSeconds: 600,
    waitSpeedThresholdKmh: cfg.waitSpeedThresholdKmh,
  }) > 0,
  "Heurística espera",
);

async function providerCases() {
  const provider = new LocalTariffProvider();
  assert(provider.id === "supabase_fare_rules_v1", "Provider id");

  // Cálculo puro (sin I/O): mismo path que provider tras resolver holidays en DB.
  const quote = calculateTariff({
    kind: "estimated",
    config: cfg,
    distanceMeters: 500,
    durationSeconds: 120,
    waitSeconds: 0,
    waitSource: "none",
    at: new Date("2026-07-21T10:00:00"),
    isPublicHoliday: false,
    provider: provider.id,
  });
  assert(quote.amount === 7400, "Cálculo post-holidays flag");
  assert(
    tariffQuoteToFareQuote(quote).breakdown.surchargeWhatxia === 800,
    "Adapter plataforma",
  );

  console.log("\nTariff holidays SSoT: todas las aserciones OK");
}

providerCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
