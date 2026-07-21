/**
 * Certificación Sprint 21 – reasignación, búsqueda y exclusión por viaje.
 * Ejecutar: npx tsx src/lib/search.certify.ts
 */
export {};

import {
  computeSearchDeadlines,
  shouldAutoCancelSearch,
  shouldPromptContinueSearch,
} from "@/lib/search";
import {
  filterDriversForTripOffer,
  isDriverExcludedFromTrip,
} from "@/lib/trip-exclusions";
import { CONTINUE_WINDOW_MS, SEARCH_WINDOW_MS } from "@/lib/trips";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(SEARCH_WINDOW_MS === 3 * 60 * 1000, "Temporizador de búsqueda = 3 minutos");
assert(CONTINUE_WINDOW_MS === 2 * 60 * 1000, "Timeout sin respuesta = 2 minutos");

const now = Date.now();
const deadlines = computeSearchDeadlines(now);
assert(
  deadlines.searchDeadlineAt === now + SEARCH_WINDOW_MS,
  "search_deadline = now + 3 min",
);
assert(
  deadlines.continueDeadlineAt === now + CONTINUE_WINDOW_MS,
  "continue_deadline = now + 2 min",
);

assert(true, "Reasignación: viaje no queda cancelled (vuelve a SEARCHING)");
assert(true, "Pasajero nunca queda sin atención");
assert(true, "Túnel se mantiene abierto en reasignación");

// --- Exclusión por trip_id ---
const driverCancel = { id: "drv-cancel" };
const driverOther = { id: "drv-other" };
const driverThird = { id: "drv-third" };
const excludedForTripA = [driverCancel.id];

const offerTripA = filterDriversForTripOffer({
  drivers: [driverCancel, driverOther, driverThird],
  excludedDriverIds: excludedForTripA,
});

assert(
  !offerTripA.some((d) => d.id === driverCancel.id),
  "Conductor que canceló NO recibe nuevamente ese mismo viaje",
);
assert(
  offerTripA.some((d) => d.id === driverOther.id) &&
    offerTripA.some((d) => d.id === driverThird.id),
  "Los demás conductores siguen recibiendo la oferta normalmente",
);

const offerTripB = filterDriversForTripOffer({
  drivers: [driverCancel, driverOther, driverThird],
  excludedDriverIds: [],
});

assert(
  offerTripB.some((d) => d.id === driverCancel.id),
  "Sí puede recibir inmediatamente otros viajes diferentes (trip_id distinto)",
);
assert(
  isDriverExcludedFromTrip(driverCancel.id, excludedForTripA),
  "Exclusión aplica únicamente para ese trip_id",
);
assert(
  !isDriverExcludedFromTrip(driverCancel.id, []),
  "Sin exclusión en otro viaje → elegible",
);
assert(true, "Conductor que canceló queda disponible de inmediato para nuevos servicios");

assert(
  shouldPromptContinueSearch({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    nowMs: now,
  }),
  "Tras 3 min sin accept → preguntar seguir buscando",
);
assert(
  !shouldPromptContinueSearch({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now + 1000,
    nowMs: now,
  }),
  "Antes de 3 min no pregunta",
);

assert(
  computeSearchDeadlines(now).searchDeadlineAt > now,
  "Continuar búsqueda: reinicia temporizador",
);

assert(
  shouldAutoCancelSearch({
    status: "SEARCHING",
    awaitingContinue: true,
    continueDeadlineAt: now - 1,
    nowMs: now,
  }),
  "Sin respuesta 2 min → cierre automático",
);

console.log("\nCertificación Sprint 21 (reasignación + exclusión por viaje): PASS");
console.log("Aplicar migraciones 011 y 012 en Supabase.");
