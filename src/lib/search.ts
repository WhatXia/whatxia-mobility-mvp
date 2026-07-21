import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  cancelTrip,
  CONTINUE_WINDOW_MS,
  getTrip,
  listTripsDueContinueTimeout,
  listTripsDueSearchPrompt,
  markSearchAwaitingContinue,
  SEARCH_WINDOW_MS,
  samePhone,
  startSearchCycle,
  type Trip,
} from "@/lib/trips";
import { clearSession, upsertSession } from "@/lib/sessions";
import { closeTunnelForTrip } from "@/lib/tunnels";

export const SEARCH_CONTINUE_PREFIX = "search_continue";
export const SEARCH_CANCEL_PREFIX = "search_cancel";

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
  nowMs: number;
}): boolean {
  return (
    input.status === "SEARCHING" &&
    !input.awaitingContinue &&
    input.searchDeadlineAt !== null &&
    input.searchDeadlineAt <= input.nowMs
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

async function sendContinueSearchPrompt(trip: Trip): Promise<void> {
  await sendButtonsMessage(
    trip.passengerPhone,
    "Aún no hemos encontrado un conductor disponible. ¿Deseas que sigamos buscando?",
    [
      {
        id: searchContinueButtonId(trip.id),
        title: "✅ Seguir buscando",
      },
      {
        id: searchCancelButtonId(trip.id),
        title: "❌ Cancelar solic.",
      },
    ],
  );
}

export async function closeSearchWithoutDriver(
  tripId: string,
  message: string,
): Promise<Trip | null> {
  const cancelled = await cancelTrip(tripId);
  if (!cancelled) {
    return null;
  }

  await closeTunnelForTrip(cancelled.id);
  await clearSession(cancelled.passengerPhone);
  await sendTextMessage(cancelled.passengerPhone, message);

  console.log("[search:closed]", { tripId: cancelled.id });
  return cancelled;
}

/**
 * Procesa vencimientos de búsqueda (lazy en cada webhook + cron opcional).
 */
export async function processDueSearchTimeouts(): Promise<{
  prompted: number;
  autoCancelled: number;
}> {
  let prompted = 0;
  let autoCancelled = 0;

  const duePrompt = await listTripsDueSearchPrompt();

  for (const trip of duePrompt) {
    const marked = await markSearchAwaitingContinue(trip.id);
    if (!marked) {
      continue;
    }

    await sendContinueSearchPrompt(marked);
    prompted += 1;
    console.log("[search:prompt-continue]", { tripId: marked.id });
  }

  const dueCancel = await listTripsDueContinueTimeout();

  for (const trip of dueCancel) {
    const closed = await closeSearchWithoutDriver(
      trip.id,
      "No encontramos un conductor disponible y no recibimos respuesta. La solicitud ha sido cerrada. Cuando desees un nuevo servicio, solo escríbenos nuevamente.",
    );
    if (closed) {
      autoCancelled += 1;
    }
  }

  return { prompted, autoCancelled };
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

  const cycled = await startSearchCycle(trip.id);
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

  // Túnel se mantiene; republicar oferta.
  const { republishTripToDrivers } = await import("@/lib/dispatch");
  await republishTripToDrivers(trip.id);

  console.log("[search:continue]", { tripId: trip.id });
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

  await closeSearchWithoutDriver(
    trip.id,
    "Solicitud cancelada. El canal se cerró. Escribe Hola cuando quieras un nuevo servicio.",
  );
}
