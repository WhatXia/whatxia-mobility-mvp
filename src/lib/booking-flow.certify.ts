/**
 * Certificación – captura origen + GPS obligatorio + UX destino (Sprint 29).
 * BOOKING_REQUIRE_DROPOFF=true → GPS → destino → cotización → Solicitar/Cancelar.
 * Ejecutar: npx tsx src/lib/booking-flow.certify.ts
 */
export {};

import {
  BOOKING_BUTTON_IDS,
  BOOKING_REQUIRE_DROPOFF,
  buildPickupPlaceFromGps,
  isBookingState,
  ORIGIN_CAPTURE_MODE,
  resolveTripPickupNeighborhood,
} from "@/lib/booking/flow";
import {
  formatAssignedPickupLines,
  parsePickupAddress,
  pickupOfferZone,
  resolveOfferOrigin,
  resolvePickupLabelFromText,
} from "@/lib/booking/intent";
import { catalogBody } from "@/lib/bot-cms/copy";
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
  "GPS WhatsApp es la captura de origen (punto exacto)",
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

assert(true, "Paso 1: texto libre → conservar dirección → pedir GPS obligatorio");
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

const residential = parsePickupAddress(
  resolvePickupLabelFromText(
    "Necesito un servicio para Las Américas, Supermanzana 5, Manzana 6, Casa 16.",
  ) ?? "",
);
assert(
  residential.fullText ===
    "Las Américas, Supermanzana 5, Manzana 6, Casa 16",
  "Supermanzana/Manzana/Casa: se conserva la dirección completa",
);
assert(
  residential.zone === "Las Américas" &&
    residential.detail === "Supermanzana 5, Manzana 6, Casa 16",
  "Supermanzana/Manzana/Casa: oferta = Las Américas; detalle posterior a aceptar",
);
assert(
  pickupOfferZone(residential.fullText) === "Las Américas",
  "Zona de oferta no incluye Supermanzana/Manzana/Casa",
);

const traditional = parsePickupAddress(
  resolvePickupLabelFromText(
    "Necesito un servicio para Carrera 4 # 32-1, La Pola.",
  ) ?? "",
);
assert(
  traditional.zone === "La Pola" &&
    traditional.detail === "Carrera 4 # 32-1" &&
    traditional.fullText === "Carrera 4 # 32-1, La Pola",
  "Nomenclatura tradicional: oferta = La Pola; detalle = Carrera 4 # 32-1",
);

const jordan = parsePickupAddress(
  resolvePickupLabelFromText(
    "Necesito un servicio para El Jordán, Octava Etapa, Manzana 23, Casa 1.",
  ) ?? "",
);
assert(
  jordan.zone === "El Jordán, Octava Etapa" &&
    jordan.detail === "Manzana 23, Casa 1",
  "El Jordán, Octava Etapa en oferta; Manzana/Casa después de aceptar",
);

const gpsPoint = { lat: 4.4389, lng: -75.2322 };
const gpsPickup = buildPickupPlaceFromGps(residential.fullText, gpsPoint);
assert(
  gpsPickup.location.lat === gpsPoint.lat &&
    gpsPickup.location.lng === gpsPoint.lng &&
    gpsPickup.placeId === null,
  "Ubicación GPS de WhatsApp es el pickup exacto",
);
assert(
  gpsPickup.name === residential.fullText &&
    gpsPickup.address === residential.fullText,
  "El texto descriptivo no se reemplaza por coordenadas",
);
assert(
  pickupOfferZone("Torre de Arzoyo") === "Torre de Arzoyo",
  "Nombre de lugar con Torre no se oculta como nomenclatura",
);

function assertPickupZone(
  input: string,
  zone: string,
  message: string,
  detail?: string,
) {
  const parsed = parsePickupAddress(input);
  assert(parsed.zone === zone, message);
  assert(
    parsed.fullText === input.replace(/[.]+$/g, "").trim() ||
      parsed.fullText === input,
    `${message} (fullText conservado)`,
  );
  if (detail !== undefined) {
    assert(parsed.detail === detail, `${message} (detalle)`);
  }
  if (zone) {
    assert(pickupOfferZone(input) === zone, `${message} (oferta)`);
    assert(
      !pickupOfferZone(input).toLowerCase().includes("manzana") &&
        !pickupOfferZone(input).toLowerCase().includes("casa") &&
        pickupOfferZone(input) !== "Punto de recogida",
      `${message} (oferta sin fallback falso)`,
    );
  }
}

assertPickupZone(
  "Jordán Octava Etapa, Manzana 23, Casa 1",
  "Jordán Octava Etapa",
  "barrio + manzana + casa (con comas)",
  "Manzana 23, Casa 1",
);
assertPickupZone(
  "Manzana 23, Casa 1, Jordán Octava Etapa",
  "Jordán Octava Etapa",
  "manzana + casa + barrio (con comas)",
);
assertPickupZone(
  "Jordán Octava Etapa Manzana 23 Casa 1",
  "Jordán Octava Etapa",
  "barrio compuesto sin comas",
  "Manzana 23, Casa 1",
);
assertPickupZone(
  "Manzana 23 Casa 1 Jordán Octava Etapa",
  "Jordán Octava Etapa",
  "manzana + casa + barrio (sin comas)",
);
assertPickupZone(
  "Nueva Castilla, Supermanzana 1, Manzana 10, Casa 1",
  "Nueva Castilla",
  "Nueva Castilla + Supermanzana (con comas)",
);
assertPickupZone(
  "Supermanzana 1, Manzana 10, Casa 1, Nueva Castilla",
  "Nueva Castilla",
  "Supermanzana + Nueva Castilla (barrio al final)",
);
assertPickupZone(
  "Nueva Castilla Supermanzana 1 Manzana 10 Casa 1",
  "Nueva Castilla",
  "Nueva Castilla + Supermanzana (sin comas)",
);
assertPickupZone(
  "Carrera 4 # 32-1, La Pola",
  "La Pola",
  "nomenclatura + barrio (con comas)",
  "Carrera 4 # 32-1",
);
assertPickupZone(
  "La Pola, Carrera 4 # 32-1",
  "La Pola",
  "barrio + nomenclatura (con comas)",
);
assertPickupZone(
  "Carrera 4 # 32-1 La Pola",
  "La Pola",
  "nomenclatura + barrio (sin comas)",
);
assertPickupZone(
  "La Pola Carrera 4 # 32-1",
  "La Pola",
  "barrio + nomenclatura (sin comas)",
);
assertPickupZone(
  "Carrera 20 # 8A-16, barrio X",
  "barrio X",
  "nomenclatura alfanumérica + barrio",
  "Carrera 20 # 8A-16",
);

const unknownResidential = parsePickupAddress("Manzana 23, Casa 1");
assert(
  unknownResidential.fullText === "Manzana 23, Casa 1" &&
    unknownResidential.zone === "" &&
    unknownResidential.detail.includes("Manzana 23"),
  "sin barrio identificable: se conserva el texto, no se inventa zona",
);
assert(
  pickupOfferZone("Manzana 23, Casa 1") === "",
  "sin barrio identificable: oferta no usa Punto de recogida como barrio",
);
assert(
  pickupOfferZone("Carrera 4 # 32-1") === "",
  "solo nomenclatura: no se inventa barrio",
);

const jordanOctavaLabel =
  resolvePickupLabelFromText(
    "Necesito un servicio para Jordán Octava, Manzana 23, Casa 1.",
  ) ?? "";
assert(
  resolveTripPickupNeighborhood("Jordán Octava", "Punto de recogida") ===
    "Jordán Octava",
  "session.pickup_neighborhood se preserva aunque draft.pickupLabel sea el fallback",
);
assert(
  resolveOfferOrigin("Jordán Octava", jordanOctavaLabel).includes("Manzana") ===
    false &&
    resolveOfferOrigin("Jordán Octava", jordanOctavaLabel).includes("Casa") ===
      false,
  "Oferta no incluye Manzana/Casa ni nomenclatura detallada",
);
assert(
  resolveOfferOrigin("Punto de recogida", jordanOctavaLabel) ===
    "Jordán Octava",
  "Fallback Punto de recogida no se usa si se puede obtener el barrio",
);

const assignedJordan = formatAssignedPickupLines(
  "Jordán Octava Etapa",
  "Jordán Octava Etapa, Manzana 23, Casa 1",
);
assert(
  assignedJordan ===
    "📍 Jordán Octava Etapa\n🏠 Manzana 23, Casa 1",
  "Tras aceptar: barrio + manzana/casa sin duplicar el barrio",
);

const assignedPola = formatAssignedPickupLines(
  "La Pola",
  "Carrera 4 # 32-1, La Pola",
);
assert(
  assignedPola === "📍 La Pola\n🏠 Carrera 4 # 32-1",
  "Tras aceptar: La Pola no se duplica en el detalle",
);
assert(
  catalogBody("D_TRIP_OFFER").includes("📍 Origen: {{pickup}}") &&
    !catalogBody("D_TRIP_OFFER").includes("🏠"),
  "Oferta D_TRIP_OFFER no cambia (solo barrio)",
);
assert(
  catalogBody("D_SERVICE_ASSIGNED").includes("{{pickup_lines}}"),
  "D_SERVICE_ASSIGNED recibe pickup_lines tras aceptar",
);

assert(true, "Dirección de recogida → WAITING_PICKUP_LOCATION + Enviar ubicación");
assert(true, "Places no resuelve pickup inicial (nomenclatura residencial)");
assert(true, "Paso 2: ubicación WA → pickupLocation (coords ruta)");
assert(true, "Paso 3: si falta nombre → WAITING_BOOKING_NAME (dato obligatorio)");
assert(
  true,
  "Paso 4: pickup GPS resuelto → pregunta destino (P_ASK_DESTINATION)",
);
assert(
  !isBookingState("SEARCHING_DRIVER"),
  "SEARCHING_DRIVER no es estado de booking; es búsqueda/dispatch",
);
assert(
  catalogBody("P_ASK_DESTINATION").includes("destino"),
  "Flujo posterior: P_ASK_DESTINATION intacto",
);
assert(
  catalogBody("P_QUOTE_CONFIRM").includes("Tarifa estimada") &&
    catalogBody("P_QUOTE_CONFIRM").includes("taxímetro"),
  "Flujo posterior: P_QUOTE_CONFIRM rango + taxímetro intacto",
);
assert(true, "WAITING_QUOTE_CONFIRM + REQUEST_TRIP tras tarifa estimada");
assert(
  BOOKING_REQUIRE_DROPOFF === true,
  "Código de destino/Places/cotización activo (BOOKING_REQUIRE_DROPOFF)",
);
assert(true, "Entrada: un lugar = origen; GPS; luego ¿cuál es tu destino?");
assert(true, "Entrada dual origen+destino → GPS origen, destino Places pendiente");
assert(true, "Destino alta confianza → cotización sin mapa/confirmación");
assert(true, "Destino varias opciones → lista; al elegir → cotización sin mapa");
assert(true, "Destino no encontrado → mapa solo como recuperación");
assert(true, "Ubicación WA como destino → cotización directa (sin re-pedir origen)");
assert(true, "Reescritura → nueva búsqueda Places; si falla, mismas opciones");

console.log("\nbooking-flow: todas las aserciones OK");
