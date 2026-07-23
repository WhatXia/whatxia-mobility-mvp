/**
 * Certificación – intención Mobility: un lugar = origen; ambos = cotización.
 * Ejecutar: npx tsx src/lib/intent.certify.ts
 */
export {};

import {
  extractBothPlaces,
  extractSinglePlaceFromText,
  hasServiceIntent,
  parseMobilityIntent,
  stripLeadingGreeting,
} from "@/lib/booking/intent";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(
  stripLeadingGreeting("Hola, necesito un servicio") ===
    "necesito un servicio",
  "strip saludo Hola,",
);

const cases: Array<{
  text: string;
  intent: boolean;
  pickup: string | null;
  dest: string | null;
}> = [
  {
    text: "Hola, necesito un servicio para Jordán Octava Etapa",
    intent: true,
    pickup: "Jordán Octava Etapa",
    dest: null,
  },
  {
    text: "Necesito un servicio para la 43 con Quinta",
    intent: true,
    pickup: "la 43 con Quinta",
    dest: null,
  },
  {
    text: "Quiero un viaje al Jordán Octava Etapa",
    intent: true,
    pickup: "Jordán Octava Etapa",
    dest: null,
  },
  {
    text: "Llévame al aeropuerto",
    intent: true,
    pickup: "aeropuerto",
    dest: null,
  },
  {
    text: "Necesito un servicio",
    intent: true,
    pickup: null,
    dest: null,
  },
  {
    text: "Estoy en la 60 con Ambalá y voy para Multicentro",
    intent: true,
    pickup: "la 60 con Ambalá",
    dest: "Multicentro",
  },
  {
    text: "Desde el estadio hacia el aeropuerto",
    intent: true,
    pickup: "el estadio",
    dest: "el aeropuerto",
  },
  {
    text: "Hola",
    intent: false,
    pickup: null,
    dest: null,
  },
  {
    text: "¿Cuánto cuesta la gasolina?",
    intent: false,
    pickup: null,
    dest: null,
  },
  {
    text: "para el aeropuerto Perales",
    intent: true,
    pickup: "el aeropuerto Perales",
    dest: null,
  },
];

for (const c of cases) {
  const parsed = parseMobilityIntent(c.text);
  assert(
    parsed.isServiceIntent === c.intent,
    `intent(${JSON.stringify(c.text)}) → ${c.intent}`,
  );
  assert(
    parsed.pickupText === c.pickup,
    `pickup(${JSON.stringify(c.text)}) → ${JSON.stringify(c.pickup)} (got ${JSON.stringify(parsed.pickupText)})`,
  );
  assert(
    parsed.destinationText === c.dest,
    `dest(${JSON.stringify(c.text)}) → ${JSON.stringify(c.dest)} (got ${JSON.stringify(parsed.destinationText)})`,
  );
}

assert(hasServiceIntent("Pido un taxi ya"), "hasServiceIntent taxi");
assert(
  extractBothPlaces("Estoy en la 60 y voy para Multicentro")?.destinationText ===
    "Multicentro",
  "extractBothPlaces",
);
assert(
  extractSinglePlaceFromText("Necesito un servicio en el Centro") ===
    "el Centro",
  "un lugar = origen",
);

console.log("\nintent certify (origen primero): todas las aserciones OK");
