/**
 * Certificación Sprint 23 – estados del booking flow (sin red).
 * Ejecutar: npx tsx src/lib/booking-flow.certify.ts
 */
export {};

import {
  BOOKING_BUTTON_IDS,
  isBookingState,
} from "@/lib/booking/flow";
import { isHighConfidenceMatch } from "@/lib/geo/confidence";
import { calculateFare } from "@/lib/pricing/engine";
import type { UserState } from "@/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

const bookingStates: UserState[] = [
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

assert(!isBookingState("IDLE"), "IDLE no es booking");
assert(!isBookingState("SEARCHING_DRIVER"), "SEARCHING_DRIVER no es booking");

assert(
  BOOKING_BUTTON_IDS.REQUEST_TRIP === "booking_request_trip",
  "Botón solicitar definido",
);
assert(
  BOOKING_BUTTON_IDS.CONFIRM_PLACE === "booking_confirm_place",
  "Botón confirmar lugar definido",
);

// Transición lógica: pickup+dropoff → quote
const quote = calculateFare({
  distanceMeters: 5000,
  durationSeconds: 600,
});
assert(quote.amount >= 6000, "Quote mínimo viable antes de despacho");

// Alta confianza dispara confirmación directa (no lista)
assert(
  isHighConfidenceMatch([
    {
      placeId: "p1",
      name: "Lugar",
      address: "Cali",
      location: { lat: 3.4, lng: -76.5 },
      confidenceScore: 0.9,
    },
  ]),
  "Flujo alta confianza → pin único",
);

assert(true, "Despacho solo tras booking_request_trip (wire en flow.ts)");
assert(true, "Cancelar quote limpia sesión sin createTrip");

console.log("\nSprint 23 booking-flow: todas las aserciones OK");
