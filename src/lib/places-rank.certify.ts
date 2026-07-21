/**
 * Certificación Sprint 23 – ranking / confianza Places.
 * Ejecutar: npx tsx src/lib/places-rank.certify.ts
 */
export {};

import {
  isHighConfidenceMatch,
  rankPlaceCandidates,
  topCandidates,
} from "@/lib/geo/confidence";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const ranked = rankPlaceCandidates([
  {
    placeId: "a",
    name: "Caminos del Vergel",
    address: "Cali",
    location: { lat: 3.4, lng: -76.5 },
  },
  {
    placeId: "b",
    name: "Otro",
    address: "Cali",
    location: { lat: 3.41, lng: -76.51 },
  },
  {
    placeId: "c",
    name: "Tercero",
    address: "Cali",
    location: { lat: 3.42, lng: -76.52 },
  },
  {
    placeId: "d",
    name: "Cuarto",
    address: "Cali",
    location: { lat: 3.43, lng: -76.53 },
  },
]);

assert(ranked[0].confidenceScore === 1, "Top score 1.0");
assert(ranked[1].confidenceScore === 0.85, "Segundo 0.85");
assert(topCandidates(ranked, 3).length === 3, "Máximo 3 candidatos");

assert(
  isHighConfidenceMatch(
    [
      {
        placeId: "only",
        name: "Único",
        address: "",
        location: { lat: 0, lng: 0 },
        confidenceScore: 0.8,
      },
    ],
    0.75,
  ),
  "Un solo candidato >= umbral = alta confianza",
);

assert(
  !isHighConfidenceMatch(
    [
      {
        placeId: "only",
        name: "Único",
        address: "",
        location: { lat: 0, lng: 0 },
        confidenceScore: 0.5,
      },
    ],
    0.75,
  ),
  "Un solo candidato bajo umbral = no alta confianza",
);

const closeScores = [
  { ...ranked[0], confidenceScore: 0.9 },
  { ...ranked[1], confidenceScore: 0.85 },
];
assert(
  !isHighConfidenceMatch(closeScores, 0.75),
  "Sin margen suficiente entre 1º y 2º → lista",
);

const clearWinner = [
  { ...ranked[0], confidenceScore: 1.0 },
  { ...ranked[1], confidenceScore: 0.7 },
];
assert(
  isHighConfidenceMatch(clearWinner, 0.75),
  "Con margen >= PLACE_TOP_MARGIN → alta confianza",
);

console.log("\nSprint 23 places-rank: todas las aserciones OK");
