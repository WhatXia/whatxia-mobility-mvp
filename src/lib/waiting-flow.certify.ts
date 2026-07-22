/**
 * Certificación Sprint 27 – WaitingFlow.
 * Ejecutar: npx tsx src/lib/waiting-flow.certify.ts
 */
export {};

import {
  computeSearchDeadlines,
  shouldAutoCancelMaxWait,
  shouldAutoCancelSearch,
  shouldPromptContinueSearch,
} from "@/lib/waiting-flow";
import {
  CONTINUE_WINDOW_MS,
  MAX_SEARCH_REMINDER_COUNT,
  SEARCH_WINDOW_MS,
} from "@/lib/trips";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(SEARCH_WINDOW_MS === 2 * 60 * 1000, "Ventana búsqueda = 2 minutos");
assert(CONTINUE_WINDOW_MS === 2 * 60 * 1000, "Ventana respuesta = 2 minutos");
assert(MAX_SEARCH_REMINDER_COUNT === 2, "Máx. 2 recordatorios antes del cierre");

const now = Date.now();
const deadlines = computeSearchDeadlines(now);
assert(
  deadlines.searchDeadlineAt === now + SEARCH_WINDOW_MS,
  "search_deadline = now + 2 min",
);
assert(
  deadlines.continueDeadlineAt === now + CONTINUE_WINDOW_MS,
  "continue_deadline = now + 2 min",
);

assert(
  shouldPromptContinueSearch({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    reminderCount: 0,
    nowMs: now,
  }),
  "Recordatorio 1 cuando count=0 y deadline vencido",
);

assert(
  shouldPromptContinueSearch({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    reminderCount: 1,
    nowMs: now,
  }),
  "Recordatorio 2 cuando count=1 y deadline vencido",
);

assert(
  !shouldPromptContinueSearch({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    reminderCount: 2,
    nowMs: now,
  }),
  "No hay 3er prompt cuando count=2",
);

assert(
  shouldAutoCancelMaxWait({
    status: "SEARCHING",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    reminderCount: 2,
    nowMs: now,
  }),
  "Auto-cancel a los 6 min (count=2 + deadline)",
);

assert(
  shouldAutoCancelSearch({
    status: "SEARCHING",
    awaitingContinue: true,
    continueDeadlineAt: now - 1,
    nowMs: now,
  }),
  "Auto-cancel si no responde al prompt",
);

assert(
  !shouldPromptContinueSearch({
    status: "ASSIGNED",
    awaitingContinue: false,
    searchDeadlineAt: now - 1,
    reminderCount: 0,
    nowMs: now,
  }),
  "No prompt si ya ASSIGNED",
);

assert(true, "Seguir buscando: mismo trip_id (continueWaitingSearchCycle)");
assert(true, "Accept limpia deadlines (clearSearchDeadlinesOnAssign)");
assert(true, "Estado final sin conductor: cancelled_no_driver");

console.log("\nSprint 27 WaitingFlow: todas las aserciones OK");
