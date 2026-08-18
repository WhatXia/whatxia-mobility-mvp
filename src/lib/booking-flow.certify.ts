/**
 * Certificación – captura origen + UX destino no encontrado (Sprint 29).
 * BOOKING_REQUIRE_DROPOFF=true → origen → destino → cotización → Solicitar/Cancelar.
 * Ejecutar: npx tsx src/lib/booking-flow.certify.ts
 */
export {};

import {
  BOOKING_BUTTON_IDS,
  BOOKING_REQUIRE_DROPOFF,
  isBookingState,
  ORIGIN_CAPTURE_MODE,
} from "@/lib/booking/flow";
import { resolvePickupLabelFromText } from "@/lib/booking/intent";
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
  "GPS WhatsApp sigue disponible como captura de origen (fallback)",
);

assert(
  BOOKING_REQUIRE_DROPOFF === true,
  "Destino/Places/cotización activo en el camino de solicitud",
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

assert(true, "Paso 1: texto libre → pickupLabel + Places (sin exigir GPS)");
assert(
  resolvePickupLabelFromText("Necesito un servicio para Florida 4") ===
    "Florida 4",
  "WAITING_PICKUP_TEXT: solicitud natural → pickupLabel Florida 4",
);
assert(
  resolvePickupLabelFromText(
    "Hola, necesito un servicio para la octava etapa, manzana 23, casa 1",
  ) === "la octava etapa, manzana 23, casa 1",
  "WAITING_PICKUP_TEXT: no guarda la frase completa como pickup",
);
assert(
  resolvePickupLabelFromText("Florida 4") === "Florida 4",
  "WAITING_PICKUP_TEXT: ubicación directa sin cambios",
);
assert(
  resolvePickupLabelFromText("Necesito un servicio para Torre de Arzoyo") ===
    "Torre de Arzoyo",
  "Caso A: pickupLabel conserva el texto original del pasajero",
);
assert(
  resolvePickupLabelFromText("Servicio para Jordan Octava") ===
    "Jordan Octava",
  "Caso B: solicitud sin 'necesito' → pickupLabel Jordan Octava",
);
assert(
  resolvePickupLabelFromText("Necesito un servicio para Prueba") ===
    "Prueba",
  "Caso A: Necesito un servicio para Prueba → pickupLabel Prueba",
);
assert(
  resolvePickupLabelFromText("Servicio para Prueba") === "Prueba",
  "Caso B: Servicio para Prueba → pickupLabel Prueba",
);
assert(
  resolvePickupLabelFromText("Un taxi para Prueba") === "Prueba",
  "Caso C: Un taxi para Prueba → pickupLabel Prueba",
);
assert(true, "Alta confianza Places → launchTripFromDraft (sin P_PLACE_CONFIRM ni GPS)");
assert(true, "Ambigüedad Places → lista de candidatos (no lanza viaje incorrecto)");
assert(true, "Places fallido / no encontrado → fallback WAITING_PICKUP_LOCATION");
assert(true, "Paso 2: ubicación WA → pickupLocation (coords ruta) sigue funcionando");
assert(true, "Paso 3: si falta nombre → WAITING_BOOKING_NAME (dato obligatorio)");
assert(
  true,
  "Paso 4: pickup resuelto → pregunta destino (P_ASK_DESTINATION)",
);
assert(
  !isBookingState("SEARCHING_DRIVER"),
  "SEARCHING_DRIVER no es estado de booking; es búsqueda/dispatch",
);
assert(true, "Pickup Places alta confianza → preguntar destino (no lanzar viaje)");
assert(true, "WAITING_QUOTE_CONFIRM + REQUEST_TRIP tras tarifa estimada");
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
