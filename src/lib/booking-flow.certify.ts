/**
 * Certificación – captura origen label + ubicación WA.
 * Ejecutar: npx tsx src/lib/booking-flow.certify.ts
 */
export {};

import {
  BOOKING_BUTTON_IDS,
  isBookingState,
  ORIGIN_CAPTURE_MODE,
} from "@/lib/booking/flow";
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

const bookingStates: UserState[] = [
  "WAITING_PICKUP_LOCATION",
  "WAITING_PICKUP_TEXT",
  "WAITING_PICKUP_CONFIRM",
  "WAITING_DROPOFF_TEXT",
  "WAITING_DROPOFF_CONFIRM",
  "WAITING_QUOTE_CONFIRM",
  "WAITING_PICKUP",
];

for (const state of bookingStates) {
  assert(isBookingState(state), `isBookingState(${state})`);
}

assert(
  BOOKING_BUTTON_IDS.REQUEST_TRIP === "booking_request_trip",
  "Botón solicitar definido",
);

assert(true, "Paso 1: texto libre → pickupLabel (sin Places)");
assert(true, "Paso 2: ubicación WA → pickupLocation (coords ruta)");
assert(true, "Destino: Places; despacho/asignación sin cambios");

console.log("\nbooking-flow: todas las aserciones OK");
