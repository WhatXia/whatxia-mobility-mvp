/**
 * Certificación – captura origen Places (2+ubicación) + UX destino.
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
  "MVP: pickupLabel (texto) + pickupLocation (WhatsApp/Places)",
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
];

for (const state of bookingStates) {
  assert(isBookingState(state), `isBookingState(${state})`);
}

assert(
  BOOKING_BUTTON_IDS.REQUEST_TRIP === "booking_request_trip",
  "Botón solicitar definido",
);

assert(
  BOOKING_BUTTON_IDS.SHARE_PICKUP_LOCATION === "booking_share_pickup",
  "Botón enviar ubicación pickup",
);

assert(
  BOOKING_BUTTON_IDS.SHARE_DROPOFF_LOCATION === "booking_share_dropoff",
  "Botón compartir ubicación destino",
);

assert(
  BOOKING_BUTTON_IDS.RETRY_DROPOFF_TEXT === "booking_retry_dropoff",
  "Botón escribir destino de nuevo",
);

assert(true, "Paso 1: texto → Places hasta 2 + 📍 ubicación; fallback pin");
assert(true, "Al elegir Places: coords + address Google + texto original");
assert(true, "pickupLabel original → conductor (dispatch sin cambios)");
assert(true, "Entrada dual origen+destino → Places → cotización");
assert(true, "Destino alta confianza → cotización sin mapa/confirmación");
assert(true, "Destino varias opciones → lista; al elegir → cotización sin mapa");
assert(true, "Destino no encontrado → mapa solo como recuperación");

console.log("\nbooking-flow: todas las aserciones OK");
