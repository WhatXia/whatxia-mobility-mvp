/**
 * Certificación aislamiento multi-ciudad (trip.city_id).
 * Ejecutar: npx tsx src/lib/multicity.certify.ts
 */
export {};

import {
  resolveCityFromPointSync,
  type City,
} from "@/lib/city/context";
import {
  canAcceptTripInCity,
  filterDriversByTripCity,
  republishKeepsTripCity,
} from "@/lib/city/isolation";
import { driverServesOriginCity } from "@/lib/city/corridors";
import {
  planTripCompletion,
  pricingModeForCitySlug,
  shouldFinalizeFare,
} from "@/lib/city/pricing";
import { mapFareRulesRowToCityTariff } from "@/lib/tariff/config-loader";
import { calculateTariff } from "@/lib/tariff/calculator";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const ibague: City = {
  id: "city-ibague",
  slug: "ibague",
  name: "Ibagué",
  region: "Tolima",
  countryCode: "CO",
  center: { lat: 4.4389, lng: -75.2322 },
  radiusMeters: 18000,
  active: true,
};

const pasto: City = {
  id: "city-pasto",
  slug: "pasto",
  name: "Pasto",
  region: "Nariño",
  countryCode: "CO",
  center: { lat: 1.2136, lng: -77.2811 },
  radiusMeters: 20000,
  active: true,
};

const enabled = [ibague, pasto];

const drivers = [
  { id: "d-iba-1", city_id: ibague.id },
  { id: "d-iba-2", city_id: ibague.id },
  { id: "d-pas-1", city_id: pasto.id },
];

// Test 1 — Ibagué
assert(
  filterDriversByTripCity(drivers, ibague.id).every((d) => d.city_id === ibague.id) &&
    filterDriversByTripCity(drivers, ibague.id).length === 2,
  "Test 1: trip Ibagué solo recibe conductores Ibagué",
);

// Test 2 — Pasto
assert(
  filterDriversByTripCity(drivers, pasto.id).every((d) => d.city_id === pasto.id) &&
    filterDriversByTripCity(drivers, pasto.id).length === 1,
  "Test 2: trip Pasto solo recibe conductores Pasto",
);

// Test 3 — Cross-city dispatch
assert(
  !filterDriversByTripCity(drivers, ibague.id).some((d) => d.city_id === pasto.id),
  "Test 3: conductor Pasto no entra al universo de un viaje Ibagué",
);

// Test 4 — Cross-city accept
assert(
  canAcceptTripInCity(ibague.id, ibague.id),
  "Test 4a: accept misma ciudad permitido",
);
assert(
  !canAcceptTripInCity(ibague.id, pasto.id),
  "Test 4b: accept Pasto→viaje Ibagué rechazado",
);
assert(
  !canAcceptTripInCity(ibague.id, null),
  "Test 4c: accept sin driver.city_id rechazado",
);
assert(
  !canAcceptTripInCity(null, ibague.id),
  "Test 4d: accept sin trip.city_id rechazado",
);

// Test 5 — Republish conserva city_id
assert(
  republishKeepsTripCity(pasto.id, pasto.id),
  "Test 5a: republish Pasto conserva trip.city_id",
);
assert(
  !republishKeepsTripCity(pasto.id, ibague.id),
  "Test 5b: republish no puede cambiar la ciudad del viaje",
);
assert(
  filterDriversByTripCity(drivers, pasto.id).map((d) => d.id).join() === "d-pas-1",
  "Test 5c: republish Pasto busca solo conductores Pasto",
);

// Test 6 — Geo
assert(
  resolveCityFromPointSync({ lat: 4.4389, lng: -75.2322 }, enabled)?.id ===
    ibague.id,
  "Test 6a: pickup Ibagué → city_id Ibagué",
);
assert(
  resolveCityFromPointSync({ lat: 1.2136, lng: -77.2811 }, enabled)?.id ===
    pasto.id,
  "Test 6b: pickup Pasto → city_id Pasto",
);
assert(
  resolveCityFromPointSync({ lat: 4.711, lng: -74.0721 }, enabled) === null,
  "Test 6c: pickup fuera de cobertura → rechazo",
);

// Test 7 — Pricing por ciudad (Ibagué real vs Pasto placeholder 0; no inventar tarifa comercial)
const ibagueFare = mapFareRulesRowToCityTariff({
  id: "fr-iba",
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
});

const pastoFare = mapFareRulesRowToCityTariff({
  id: "fr-pas",
  currency: "COP",
  flag_drop: 0,
  minimum_fare: 0,
  min_distance_meters: 0,
  increment_meters: 100,
  increment_amount: 0,
  wait_seconds: 60,
  wait_amount: 0,
  time_unit_seconds: 60,
  time_amount: 0,
  wait_speed_threshold_kmh: 5,
  surcharge_night: 0,
  surcharge_sunday_holiday: 0,
  surcharge_airport: 0,
  surcharge_whatxia: 0,
  night_start_hour: 20,
  night_end_hour: 5,
  holiday_dates: [],
  airport_keywords: ["aeropuerto", "antonio narino"],
  airport_center_lat: 1.3964,
  airport_center_lng: -77.2915,
  airport_radius_meters: 2500,
  cities: { slug: "pasto", name: "Pasto", country_code: "CO" },
});

assert(ibagueFare.citySlug === "ibague", "Test 7a: fare_rules Ibagué → slug ibague");
assert(pastoFare.citySlug === "pasto", "Test 7b: fare_rules Pasto → slug pasto");
assert(ibagueFare.minimumFare === 6600, "Test 7c: mínima Ibagué intacta");
assert(
  pastoFare.minimumFare === 0 && pastoFare.surcharges.platform === 0,
  "Test 7d: Pasto placeholder (tarifas comerciales PENDIENTES, no inventadas)",
);

const ibaQuote = calculateTariff({
  kind: "estimated",
  config: ibagueFare,
  distanceMeters: 1600,
  durationSeconds: 300,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  isPublicHoliday: false,
  origin: { lat: 4.4389, lng: -75.2322 },
  destination: { lat: 4.44, lng: -75.23 },
  provider: "certify",
});
const pasQuote = calculateTariff({
  kind: "estimated",
  config: pastoFare,
  distanceMeters: 1600,
  durationSeconds: 300,
  waitSeconds: 0,
  waitSource: "none",
  at: new Date("2026-07-21T10:00:00"),
  isPublicHoliday: false,
  origin: { lat: 1.2136, lng: -77.2811 },
  destination: { lat: 1.22, lng: -77.28 },
  provider: "certify",
});
assert(
  ibaQuote.amount !== pasQuote.amount,
  "Test 7e: tarifa Ibagué ≠ tarifa Pasto (reglas independientes)",
);

// Test 8 — ambas habilitadas, sin singleton
assert(ibague.active && pasto.active, "Test 8a: Ibagué y Pasto habilitadas a la vez");
assert(
  resolveCityFromPointSync({ lat: 4.4389, lng: -75.2322 }, enabled)?.slug !==
    resolveCityFromPointSync({ lat: 1.2136, lng: -77.2811 }, enabled)?.slug,
  "Test 8b: resolución no depende de una única active city",
);
assert(
  filterDriversByTripCity(drivers, null).length === 0,
  "Test 8c: trip sin city_id no despacha a nadie (fail-closed)",
);

// Test 9 — pricing_mode FARE vs NO_FARE (sin inventar fare_rules de Pasto)
assert(
  pricingModeForCitySlug("ibague") === "FARE",
  "Test 9a: Ibagué opera con tarifa",
);
assert(
  pricingModeForCitySlug("pasto") === "NO_FARE",
  "Test 9b: Pasto opera sin tarifa",
);
assert(shouldFinalizeFare("ibague"), "Test 9c: Ibagué sí llama finalizeFare");
assert(!shouldFinalizeFare("pasto"), "Test 9d: Pasto no llama finalizeFare");
assert(
  planTripCompletion("ibague").runFinalizeFare &&
    !planTripCompletion("pasto").runFinalizeFare,
  "Test 9e: FARE cierra con finalizeFare; NO_FARE cierra en COMPLETED",
);

const tangua: City = {
  id: "city-tangua",
  slug: "tangua",
  name: "Tangua",
  region: "Nariño",
  countryCode: "CO",
  center: { lat: 1.0950573, lng: -77.3939558 },
  radiusMeters: 819,
  active: true,
};
assert(
  driverServesOriginCity(tangua, pasto) && !driverServesOriginCity(tangua, ibague),
  "Test 10a: origen Tangua lo atiende flota Pasto, no Ibagué",
);
assert(
  pricingModeForCitySlug("tangua") === "NO_FARE" &&
    !planTripCompletion("tangua").runFinalizeFare,
  "Test 10b: slug tangua no dispara FARE",
);

console.log("\nMulti-ciudad: Tests 1–10 OK");
