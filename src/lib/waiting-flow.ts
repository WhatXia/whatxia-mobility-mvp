import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  cancelTrip,
  CONTINUE_WINDOW_MS,
  continueWaitingSearchCycle,
  getTrip,
  listTripsDueContinueTimeout,
  listTripsDueSearchPrompt,
  markSearchAwaitingContinue,
  MAX_SEARCH_REMINDER_COUNT,
  SEARCH_WINDOW_MS,
  samePhone,
  type Trip,
} from "@/lib/trips";
import { clearSession, upsertSession } from "@/lib/sessions";
import { closeTunnelForTrip } from "@/lib/tunnels";

/**
 * WaitingFlow (Sprint 27) — independiente del DispatchEngine.
 *
 * t=0  publicar / SEARCHING
 * t=2m recordatorio 1 → esperar respuesta
 *      continuar → mismo trip, reinicia 2m
 * t=4m recordatorio 2 → esperar respuesta
 *      continuar → mismo trip, reinicia 2m
 * t=6m auto cancelled_no_driver
 *
 * Si no hay respuesta al prompt en 2m → cancelled_no_driver.
 * Si el conductor acepta → clearSearchDeadlinesOnAssign (dispatch).
 */

export const SEARCH_CONTINUE_PREFIX = "search_continue";
export const SEARCH_CANCEL_PREFIX = "search_cancel";

export const NO_DRIVER_MESSAGE = [
  "Lo sentimos.",
  "En este momento no encontramos un vehículo disponible en tu zona.",
  "Inténtalo nuevamente en unos minutos. Gracias por elegir WhatXia.",
].join("\n");

const PROMPT_WAVE_1 = [
  "Aún no hemos encontrado un conductor disponible para tu solicitud.",
  "",
  "¿Deseas que sigamos buscando?",
].join("\n");

const PROMPT_WAVE_2 = [
  "Seguimos buscando un conductor para ti.",
  "En este momento la disponibilidad es limitada.",
  "",
  "¿Deseas que continuemos buscando?",
].join("\n");

export function searchContinueButtonId(tripId: string) {
  return `${SEARCH_CONTINUE_PREFIX}:${tripId}`;
}

export function searchCancelButtonId(tripId: string) {
  return `${SEARCH_CANCEL_PREFIX}:${tripId}`;
}

export function parseSearchContinueButton(
  button: string | null,
): { tripId: string } | null {
  if (!button?.startsWith(`${SEARCH_CONTINUE_PREFIX}:`)) {
    return null;
  }
  const tripId = button.slice(SEARCH_CONTINUE_PREFIX.length + 1);
  return tripId ? { tripId } : null;
}

export function parseSearchCancelButton(
  button: string | null,
): { tripId: string } | null {
  if (!button?.startsWith(`${SEARCH_CANCEL_PREFIX}:`)) {
    return null;
  }
  const tripId = button.slice(SEARCH_CANCEL_PREFIX.length + 1);
  return tripId ? { tripId } : null;
}

/** Lógica pura de ventanas (certificación). */
export function computeSearchDeadlines(nowMs: number): {
  searchDeadlineAt: number;
  continueDeadlineAt: number;
} {
  return {
    searchDeadlineAt: nowMs + SEARCH_WINDOW_MS,
    continueDeadlineAt: nowMs + CONTINUE_WINDOW_MS,
  };
}

export function shouldPromptContinueSearch(input: {
  status: string;
  awaitingContinue: boolean;
  searchDeadlineAt: number | null;
  reminderCount: number;
  nowMs: number;
}): boolean {
  return (
    input.status === "SEARCHING" &&
    !input.awaitingContinue &&
    input.searchDeadlineAt !== null &&
    input.searchDeadlineAt <= input.nowMs &&
    input.reminderCount < MAX_SEARCH_REMINDER_COUNT
  );
}

/** Tras 2 “seguir buscando”, la 3ª ventana vencida cierra sin conductor. */
export function shouldAutoCancelMaxWait(input: {
  status: string;
  awaitingContinue: boolean;
  searchDeadlineAt: number | null;
  reminderCount: number;
  nowMs: number;
}): boolean {
  return (
    input.status === "SEARCHING" &&
    !input.awaitingContinue &&
    input.searchDeadlineAt !== null &&
    input.searchDeadlineAt <= input.nowMs &&
    input.reminderCount >= MAX_SEARCH_REMINDER_COUNT
  );
}

export function shouldAutoCancelSearch(input: {
  status: string;
  awaitingContinue: boolean;
  continueDeadlineAt: number | null;
  nowMs: number;
}): boolean {
  return (
    input.status === "SEARCHING" &&
    input.awaitingContinue &&
    input.continueDeadlineAt !== null &&
    input.continueDeadlineAt <= input.nowMs
  );
}

function promptBodyForReminderCount(reminderCount: number): string {
  return reminderCount >= 1 ? PROMPT_WAVE_2 : PROMPT_WAVE_1;
}

async function sendContinueSearchPrompt(trip: Trip): Promise<void> {
  const body = promptBodyForReminderCount(trip.searchReminderCount);

  await sendButtonsMessage(trip.passengerPhone, body, [
    {
      id: searchContinueButtonId(trip.id),
      title: "✅ Seguir buscando",
    },
    {
      id: searchCancelButtonId(trip.id),
      title: "❌ Cancelar solic.",
    },
  ]);
}

export async function closeSearchWithoutDriver(
  tripId: string,
  message: string = NO_DRIVER_MESSAGE,
): Promise<Trip | null> {
  const cancelled = await cancelTrip(tripId, "cancelled_no_driver");
  if (!cancelled) {
    return null;
  }

  await closeTunnelForTrip(cancelled.id);
  await clearSession(cancelled.passengerPhone);
  await sendTextMessage(cancelled.passengerPhone, message);

  console.log("[waiting-flow:closed]", {
    tripId: cancelled.id,
    status: cancelled.status,
  });
  return cancelled;
}

/**
 * Procesa vencimientos del WaitingFlow (lazy en webhook + cron).
 * No duplica prompts: markSearchAwaitingContinue es atómico.
 */
export async function processDueWaitingFlow(): Promise<{
  prompted: number;
  autoCancelled: number;
}> {
  let prompted = 0;
  let autoCancelled = 0;

  const duePrompt = await listTripsDueSearchPrompt();

  for (const trip of duePrompt) {
    if (trip.searchReminderCount >= MAX_SEARCH_REMINDER_COUNT) {
      const closed = await closeSearchWithoutDriver(trip.id, NO_DRIVER_MESSAGE);
      if (closed) {
        autoCancelled += 1;
      }
      continue;
    }

    const marked = await markSearchAwaitingContinue(trip.id);
    if (!marked) {
      // Otro worker ya tomó el prompt o el viaje cambió de estado.
      continue;
    }

    await sendContinueSearchPrompt(marked);
    prompted += 1;
    console.log("[waiting-flow:prompt]", {
      tripId: marked.id,
      wave: marked.searchReminderCount === 0 ? 1 : 2,
      reminderCount: marked.searchReminderCount,
    });
  }

  const dueCancel = await listTripsDueContinueTimeout();

  for (const trip of dueCancel) {
    const closed = await closeSearchWithoutDriver(trip.id, NO_DRIVER_MESSAGE);
    if (closed) {
      autoCancelled += 1;
    }
  }

  return { prompted, autoCancelled };
}

/** Alias usado por handler/cron (compat). */
export async function processDueSearchTimeouts(): Promise<{
  prompted: number;
  autoCancelled: number;
}> {
  return processDueWaitingFlow();
}

export async function handleSearchContinue(
  passengerPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(passengerPhone, "No encontramos esa solicitud.");
    return;
  }

  if (trip.status !== "SEARCHING") {
    await sendTextMessage(
      passengerPhone,
      "Esta solicitud ya no está en búsqueda.",
    );
    return;
  }

  // Mismo viaje: incrementar recordatorio + reiniciar temporizador 2 min.
  const cycled = await continueWaitingSearchCycle(trip.id);
  if (!cycled) {
    await sendTextMessage(passengerPhone, "No se pudo reiniciar la búsqueda.");
    return;
  }

  await upsertSession(passengerPhone, {
    state: "SEARCHING_DRIVER",
    pickupNeighborhood: trip.pickupNeighborhood,
  });

  await sendTextMessage(
    passengerPhone,
    "Perfecto. Seguimos buscando un conductor. Un momento, por favor.",
  );

  // Republicar oferta del mismo trip (no crea viaje nuevo).
  const { republishTripToDrivers } = await import("@/lib/dispatch");
  await republishTripToDrivers(trip.id);

  console.log("[waiting-flow:continue]", {
    tripId: cycled.id,
    reminderCount: cycled.searchReminderCount,
  });
}

export async function handleSearchCancel(
  passengerPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(passengerPhone, "No encontramos esa solicitud.");
    return;
  }

  if (trip.status !== "SEARCHING") {
    await sendTextMessage(
      passengerPhone,
      "Esta solicitud ya no se puede cancelar.",
    );
    return;
  }

  const cancelled = await cancelTrip(trip.id, "CANCELLED");
  if (!cancelled) {
    return;
  }

  await closeTunnelForTrip(cancelled.id);
  await clearSession(cancelled.passengerPhone);
  await sendTextMessage(
    passengerPhone,
    "Solicitud cancelada. Escribe Hola cuando quieras un nuevo servicio.",
  );

  console.log("[waiting-flow:user-cancel]", { tripId: cancelled.id });
}
