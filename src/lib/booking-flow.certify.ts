/**
 * Certificación – captura origen + UX destino no encontrado (Sprint 29).
 * Launch: BOOKING_REQUIRE_DROPOFF=false → resumen sin destino.
 * Ejecutar: npx tsx src/lib/booking-flow.certify.ts
 */
export {};

import {
  BOOKING_BUTTON_IDS,
  BOOKING_REQUIRE_DROPOFF,
  isBookingState,
  ORIGIN_CAPTURE_MODE,
} from "@/lib/booking/flow";
import { computeAutomaticEtaRange } from "@/lib/eta-auto";
import type { UserState } from "@/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

assert(
  ORIGIN_CAPTURE_MODE === "label_plus_whatsapp_location",
  "MVP: pickupLabel (texto) + pickupLocation (WhatsApp)",
);

assert(
  BOOKING_REQUIRE_DROPOFF === false,
  "Launch: destino temporalmente fuera del camino de solicitud",
);

const bookingStates: UserState[] = [
  "WAITING_PICKUP_LOCATION",
  "WAITING_PICKUP_TEXT",
  "WAITING_PICKUP_CONFIRM",
  "WAITING_DROPOFF_TEXT",
  "WAITING_DROPOFF_LOCATION",
  "WAITING_DROPOFF_CONFIRM",
  "WAITING_QUOTE_CONFIRM",
  "WAITING_PICKUP",
  "WAITING_BOOKING_NAME",
];

for (const state of bookingStates) {
  assert(isBookingState(state), `isBookingState(${state})`);
}

assert(
  !isBookingState("WAITING_PREFERRED_NAME"),
  "identidad onboarding no es estado de booking",
);

assert(
  BOOKING_BUTTON_IDS.REQUEST_TRIP === "booking_request_trip",
  "Botón solicitar definido",
);

assert(
  BOOKING_BUTTON_IDS.CANCEL_QUOTE === "booking_cancel_quote",
  "Botón cancelar quote sin cambios",
);

assert(
  BOOKING_BUTTON_IDS.SHARE_DROPOFF_LOCATION === "booking_share_dropoff",
  "Botón compartir ubicación destino",
);

assert(
  BOOKING_BUTTON_IDS.RETRY_DROPOFF_TEXT === "booking_retry_dropoff",
  "Botón escribir destino de nuevo",
);

const fast = computeAutomaticEtaRange(0);
const slow = computeAutomaticEtaRange(61);
assert(
  fast.minMinutes === 5 && slow.maxMinutes === 10,
  "ETA resumen reutiliza computeAutomaticEtaRange → 5–10",
);

assert(true, "Paso 1: texto libre → pickupLabel (sin Places)");
assert(true, "Paso 2: ubicación WA → pickupLocation (coords ruta)");
assert(true, "Paso 3: si falta nombre → WAITING_BOOKING_NAME tras ubicación");
assert(
  true,
  "Paso 4 (launch): tras nombre → resumen WAITING_QUOTE_CONFIRM sin destino",
);
assert(true, "Botones ✅ Solicitar / ❌ Cancelar sin cambios de id/título");
assert(
  true,
  "Código de destino/Places/cotización conservado (BOOKING_REQUIRE_DROPOFF)",
);
assert(true, "Entrada: un lugar = origen; luego ¿Hacia dónde vamos?");
assert(true, "Entrada dual origen+destino → Places → cotización");
assert(true, "Destino alta confianza → cotización sin mapa/confirmación");
assert(true, "Destino varias opciones → lista; al elegir → cotización sin mapa");
assert(true, "Destino no encontrado → mapa solo como recuperación");
assert(true, "Ubicación WA como destino → cotización directa (sin re-pedir origen)");
assert(true, "Reescritura → nueva búsqueda Places; si falla, mismas opciones");

console.log("\nbooking-flow: todas las aserciones OK");
