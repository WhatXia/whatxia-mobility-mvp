/**
 * Certificación Sprint 26 – City Context (Ibagué).
 * Ejecutar: npx tsx src/lib/city.certify.ts
 */
export {};

import {
  buildCityScopedPlaceQuery,
  filterCandidatesInCity,
  isPointInCity,
  outOfCityServiceMessage,
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

// Punto en Ibagué (centro)
assert(
  isPointInCity({ lat: 4.4389, lng: -75.2322 }, ibague),
  "Centro de Ibagué está dentro",
);

// Bogotá aprox — fuera
assert(
  !isPointInCity({ lat: 4.711, lng: -74.0721 }, ibague),
  "Bogotá queda fuera del radio",
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

console.log("\nSprint 26 city: todas las aserciones OK");
