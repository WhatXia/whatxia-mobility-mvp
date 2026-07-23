/**
 * Certificación – intención Mobility + extracción de destino (Agent Zero).
 * Ejecutar: npx tsx src/lib/intent.certify.ts
 */
export {};

import {
  hasServiceIntent,
  parseMobilityIntent,
} from "@/lib/booking/intent";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const cases: Array<{
  text: string;
  intent: boolean;
  dest: string | null;
}> = [
  {
    text: "Necesito un servicio para la 43 con Quinta",
    intent: true,
    dest: "la 43 con Quinta",
  },
  {
    text: "Quiero un viaje al Jordán Octava Etapa",
    intent: true,
    dest: "Jordán Octava Etapa",
  },
  {
    text: "Llévame al aeropuerto",
    intent: true,
    dest: "aeropuerto",
  },
  {
    text: "llevame a multicentro",
    intent: true,
    dest: "multicentro",
  },
  {
    text: "Solicito un taxi hacia el estadio",
    intent: true,
    dest: "el estadio",
  },
  {
    text: "Necesito un servicio",
    intent: true,
    dest: null,
  },
  {
    text: "Quiero un viaje por favor",
    intent: true,
    dest: null,
  },
  {
    text: "Hola",
    intent: false,
    dest: null,
  },
  {
    text: "¿Cuánto cuesta la gasolina?",
    intent: false,
    dest: null,
  },
  {
    text: "para el aeropuerto Perales",
    intent: true,
    dest: "el aeropuerto Perales",
  },
];

for (const c of cases) {
  const parsed = parseMobilityIntent(c.text);
  assert(
    parsed.isServiceIntent === c.intent,
    `intent(${JSON.stringify(c.text)}) → ${c.intent}`,
  );
  assert(
    parsed.destinationText === c.dest,
    `dest(${JSON.stringify(c.text)}) → ${JSON.stringify(c.dest)} (got ${JSON.stringify(parsed.destinationText)})`,
  );
}

assert(hasServiceIntent("Pido un taxi ya"), "hasServiceIntent taxi");
assert(
  parseMobilityIntent("Me pueden llevar al Centro Comercial").destinationText ===
    "Centro Comercial" ||
    parseMobilityIntent("Me pueden llevar al Centro Comercial")
      .destinationText === "el Centro Comercial",
  "extrae destino de 'me pueden llevar'",
);

console.log("\nintent certify: todas las aserciones OK");
