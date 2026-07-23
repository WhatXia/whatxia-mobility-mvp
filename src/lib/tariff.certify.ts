/**
 * Certificación Tariff Engine — SSoT fare_rules (sin depender de ibague.ts).
 * Ejecutar: npx tsx src/lib/tariff.certify.ts
 */
export {};

import {
  calculateTariff,
  distanceIncrementUnits,
  isNightTime,
  isSundayOrHoliday,
} from "@/lib/tariff/calculator";
import {
  mapFareRulesRowToCityTariff,
  type FareRulesDbRow,
} from "@/lib/tariff/config-loader";
import { deriveWaitSecondsFromSpeed } from "@/lib/tariff/waiting";
import { tariffQuoteToFareQuote } from "@/lib/tariff/adapters";
import { LocalTariffProvider } from "@/lib/tariff/provider";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

/** Fixture = tarifas oficiales Ibagué (migración 022), shape DB. */
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
  night_start_hour: 20,
  night_end_hour: 5,
  holiday_dates: ["2026-01-01"],
  airport_keywords: ["aeropuerto", "perales"],
  airport_center_lat: 4.4214,
  airport_center_lng: -75.1333,
  airport_radius_meters: 2500,
  cities: { slug: "ibague", name: "Ibagué" },
};

const cfg = mapFareRulesRowToCityTariff(fixtureRow);
assert(cfg.citySlug === "ibague", "Mapper: citySlug desde cities");
assert(cfg.surcharges.sundayHoliday === 850, "Oficial: dominical/festivo 850");
assert(cfg.surcharges.platform === 800, "Oficial: plataforma 800");
assert(cfg.flagDrop === 4500, "Oficial: banderazo 4500");
assert(cfg.minimumFare === 6600, "Oficial: carrera mínima 6600");

const short = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 120,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  provider: "certify",
});
assert(short.breakdown.officialFare === 6600, "Corto: oficial 6600");
assert(short.breakdown.surchargePlatform === 800, "Corto: plataforma 800");
assert(short.amount === 7400, "Corto: total 7400 (6600+800)");

assert(distanceIncrementUnits(4400, cfg) === 35, "35 ticks a 4400 m");
const mid = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 4400,
  durationSeconds: 600,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  provider: "certify",
});
assert(mid.amount === 8975, "Mid: 8175 + 800 = 8975");

const withWait = calculateTariff({
  kind: "final",
  config: cfg,
  distanceMeters: 1000,
  durationSeconds: 60,
  waitSeconds: 80,
  waitSource: "provided",
  at: new Date("2026-07-21T10:00:00"),
  provider: "certify",
});
assert(withWait.breakdown.waitValue === 180, "Espera 80s → 180");

assert(isNightTime(new Date("2026-07-21T21:00:00"), cfg), "21:00 nocturno");
assert(isSundayOrHoliday(new Date("2026-07-19T12:00:00"), cfg), "Domingo");

const sunday = calculateTariff({
  kind: "estimated",
  config: cfg,
  distanceMeters: 500,
  durationSeconds: 60,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-19T12:00:00"),
  provider: "certify",
});
assert(sunday.breakdown.surchargeSundayHoliday === 850, "Recargo domingo 850");
assert(sunday.amount === 6600 + 850 + 800, "Corto domingo + plataforma");

assert(
  deriveWaitSecondsFromSpeed({
    distanceMeters: 100,
    durationSeconds: 600,
    waitSpeedThresholdKmh: cfg.waitSpeedThresholdKmh,
  }) > 0,
  "Heurística espera por velocidad",
);

async function providerCases() {
  const provider = new LocalTariffProvider();
  assert(provider.id === "supabase_fare_rules_v1", "Provider supabase");

  const estimated = await provider.estimate(
    {
      citySlug: "ibague",
      origin: { lat: 4.4389, lng: -75.2322, label: "Centro" },
      destination: { lat: 4.45, lng: -75.22, label: "Norte" },
      distanceMeters: 500,
      durationSeconds: 120,
      at: new Date("2026-07-21T10:00:00"),
    },
    cfg,
  );
  assert(estimated.amount === 7400, "provider.estimate usa config inyectada (DB)");

  const legacy = tariffQuoteToFareQuote(estimated);
  assert(legacy.breakdown.surchargeWhatxia === 800, "Adapter plataforma 800");

  console.log("\nTariff Engine SSoT oficial: todas las aserciones OK");
  console.log(
    "Nota: runtime estimateFare → loadCityTariffConfig(fare_rules), sin .ts",
  );
}

providerCases().catch((error) => {
  console.error(error);
  process.exit(1);
});
