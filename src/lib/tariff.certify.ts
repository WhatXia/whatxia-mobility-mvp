/**
 * Certificación Tariff Engine — Ibagué v2 + recargo llamada off en estimado.
 * Ejecutar: npx tsx src/lib/tariff.certify.ts
 */
export {};

import {
  APPLY_CALL_SURCHARGE_ON_ESTIMATE,
  appliesSundayHolidaySurcharge,
  calculateTariff,
  distanceIncrementUnits,
  formatTariffCop,
  isNightTime,
  roundTariffToHundred,
} from "@/lib/tariff/calculator";
import {
  mapFareRulesRowToCityTariff,
  type FareRulesDbRow,
} from "@/lib/tariff/config-loader";
import { isSundayOrPublicHoliday } from "@/lib/tariff/holidays";
import { deriveWaitSecondsFromSpeed } from "@/lib/tariff/waiting";
import { tariffQuoteToFareQuote } from "@/lib/tariff/adapters";
import { LocalTariffProvider } from "@/lib/tariff/provider";
import type { CityTariffConfig, TariffKind } from "@/lib/tariff/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

/** Fixture Ibagué v2: mínima 6600, WhatXia 800, tick 80 m × $90. */
const fixtureRow: FareRulesDbRow = {
  id: "certify-row",
  currency: "COP",
  flag_drop: 4500,
  minimum_fare: 6600,
  min_distance_meters: 1600,
  increment_meters: 80,
  increment_amount: 90,
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
assert(cfg.incrementAmount === 90, "Tick distancia $90");
assert(cfg.surcharges.platform === 800, "Regla WhatXia 800 intacta en config");
assert(
  APPLY_CALL_SURCHARGE_ON_ESTIMATE === false,
  "MVP: recargo llamada off en estimado",
);

const weekday10 = new Date("2026-07-21T10:00:00");

function quoteAt(
  distanceMeters: number,
  kind: TariffKind = "estimated",
  config: CityTariffConfig = cfg,
) {
  return calculateTariff({
    kind,
    config,
    distanceMeters,
    durationSeconds: 120,
    waitSeconds: 0,
    waitSource: "none",
    at: weekday10,
    isPublicHoliday: false,
    provider: "certify",
  });
}

// --- Estimado MVP: sin recargo por llamada ---
assert(quoteAt(800).amount === 6600, "800 m estimado → $6.600 (sin llamada)");
assert(quoteAt(800).breakdown.surchargePlatform === 0, "800 m: platform 0");
assert(quoteAt(800).breakdown.minimumApplied === true, "800 m: mínima");
assert(quoteAt(800).breakdown.distanceValue === 0, "800 m: sin incrementos");

assert(quoteAt(1600).amount === 6600, "1.600 m estimado → $6.600");
assert(quoteAt(1600).breakdown.distanceValue === 0, "1.600 m: sin incrementos");

assert(distanceIncrementUnits(1680, cfg) === 1, "1.680 m → 1 tick");
assert(quoteAt(1680).amount === 6690, "1.680 m estimado → $6.690");
assert(roundTariffToHundred(6690) === 6700, "1.680 m → mostrar $6.700");

assert(distanceIncrementUnits(2000, cfg) === 5, "2.000 m → 5 ticks");
assert(quoteAt(2000).amount === 7050, "2.000 m estimado → $7.050");
assert(roundTariffToHundred(7050) === 7100, "2.000 m → mostrar $7.100");

assert(distanceIncrementUnits(3200, cfg) === 20, "3.200 m → 20 ticks");
assert(
  quoteAt(3200).amount === 6600 + 20 * 90,
  "3.200 m estimado → 6600+1800 = $8.400",
);

// Final: el recargo por llamada SÍ aplica (regla viva)
assert(quoteAt(800, "final").amount === 7400, "800 m final → $7.400 (+llamada)");
assert(
  quoteAt(800, "final").breakdown.surchargePlatform === 800,
  "final: platform 800",
);
assert(
  quoteAt(1680, "final").amount === 7490,
  "1.680 m final → $7.490 (+llamada)",
);

// Redondeo de presentación
assert(roundTariffToHundred(7840) === 7800, "7840 → 7800");
assert(roundTariffToHundred(7850) === 7900, "7850 → 7900");
assert(roundTariffToHundred(8049) === 8000, "8049 → 8000");
assert(roundTariffToHundred(8050) === 8100, "8050 → 8100");
assert(
  formatTariffCop(6690).includes("6.700") || formatTariffCop(6690).includes("6700"),
  "formatTariffCop muestra redondeado",
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
assert(sunday.amount === 6600 + 850, "Domingo estimado: 7450 (sin llamada)");

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
  holidayWeekday.amount === 6600 + 850,
  "Festivo estimado: mínima + 850",
);

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

  const quote = quoteAt(500);
  assert(quote.amount === 6600, "Estimado sin recargo llamada");
  assert(
    tariffQuoteToFareQuote(quote).breakdown.surchargeWhatxia === 0,
    "Adapter: platform 0 en estimado MVP",
  );

  console.log("\nTariff Ibagué v2 (llamada off en estimado): OK");
}

providerCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
