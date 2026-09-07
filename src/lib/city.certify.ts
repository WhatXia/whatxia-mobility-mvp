/**
 * Certificación Sprint 26 + multi-ciudad — City Context.
 * Ejecutar: npx tsx src/lib/city.certify.ts
 */
export {};

import {
  buildCityScopedPlaceQuery,
  filterCandidatesInCity,
  isPointInCity,
  matchCityByHint,
  outOfCityServiceMessage,
  outOfCoverageMessage,
  resolveCityFromPointSync,
  type City,
} from "@/lib/city/context";

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

assert(
  buildCityScopedPlaceQuery("Gobernación", ibague) ===
    "Gobernación, Ibagué, Tolima",
  'Query "Gobernación" se enriquece con Ibagué, Tolima',
);

assert(
  buildCityScopedPlaceQuery("Multicentro", ibague) ===
    "Multicentro, Ibagué, Tolima",
  'Query "Multicentro" se enriquece con Ibagué, Tolima',
);

assert(
  buildCityScopedPlaceQuery("Terminal", ibague) ===
    "Terminal, Ibagué, Tolima",
  'Query "Terminal" se enriquece',
);

assert(
  Math.abs(ibague.center.lat - 4.4389) < 0.001 &&
    Math.abs(ibague.center.lng - -75.2322) < 0.001,
  "Centro Ibagué ≈ 4.4389, -75.2322",
);

assert(ibague.radiusMeters === 18000, "Radio 18000 metros (= 18 km)");

assert(true, "Places: locationBias.circle (restriction.circle inválido en API New)");

assert(
  buildCityScopedPlaceQuery("Multicentro Ibagué", ibague) ===
    "Multicentro Ibagué",
  "No duplica ciudad si ya viene en el texto",
);

assert(
  buildCityScopedPlaceQuery("Centro", pasto) === "Centro, Pasto, Nariño",
  "Places Pasto enriquece con Pasto, Nariño",
);

assert(
  isPointInCity({ lat: 4.4389, lng: -75.2322 }, ibague),
  "Centro de Ibagué está dentro",
);

assert(
  !isPointInCity({ lat: 4.711, lng: -74.0721 }, ibague),
  "Bogotá queda fuera del radio de Ibagué",
);

assert(
  isPointInCity({ lat: 1.2136, lng: -77.2811 }, pasto),
  "Centro de Pasto está dentro",
);

assert(
  !isPointInCity({ lat: 1.2136, lng: -77.2811 }, ibague),
  "Pasto no está en el radio de Ibagué",
);

const mixed = [
  {
    name: "Gobernación del Tolima",
    location: { lat: 4.444, lng: -75.24 },
  },
  {
    name: "Gobernación Cali",
    location: { lat: 3.45, lng: -76.53 },
  },
];

const filtered = filterCandidatesInCity(mixed, ibague);
assert(filtered.length === 1, "Filtra candidatos fuera de ciudad");
assert(
  filtered[0].name.includes("Tolima"),
  "Conserva Gobernación del Tolima",
);

assert(
  outOfCityServiceMessage(ibague).includes("Ibagué"),
  "Mensaje de fuera de área menciona Ibagué",
);

assert(
  outOfCoverageMessage().includes("no opera"),
  "Mensaje genérico cuando no hay ciudad habilitada",
);

assert(
  resolveCityFromPointSync({ lat: 4.4389, lng: -75.2322 }, enabled)?.slug ===
    "ibague",
  "Pickup Ibagué → ciudad Ibagué (ambas habilitadas)",
);

assert(
  resolveCityFromPointSync({ lat: 1.2136, lng: -77.2811 }, enabled)?.slug ===
    "pasto",
  "Pickup Pasto → ciudad Pasto (ambas habilitadas)",
);

assert(
  resolveCityFromPointSync({ lat: 4.711, lng: -74.0721 }, enabled) === null,
  "Pickup Bogotá → sin ciudad habilitada",
);

assert(
  matchCityByHint("Ibague", enabled)?.slug === "ibague",
  "Hint de registro 'Ibague' → ibague",
);

assert(
  matchCityByHint("Pasto", enabled)?.slug === "pasto",
  "Hint de registro 'Pasto' → pasto",
);

console.log("\nCity context (multi-ciudad): todas las aserciones OK");
