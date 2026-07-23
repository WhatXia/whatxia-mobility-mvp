/**
 * Taxímetro de prueba — flujo WhatsApp independiente de Mobility.
 * No crea trips, no despacha, no usa booking.
 *
 * Nota Cloud API: no hay stream de live location; el inicio/fin usan pins
 * vía location_request_message (o el botón 📍 Enviar ubicación).
 *
 * Activación: marca pendiente en taximeter_test_sessions solo para enrutar
 * webhooks. Si cancela antes del pin de inicio, se borra sin crear corrida.
 * La medición “real” (startedAt + punto inicial) empieza al compartir ubicación.
 */

import type { IncomingMessage } from "@/types";
import { getActiveCity } from "@/lib/city/context";
import { estimateRoute } from "@/lib/geo/routes";
import type { GeoPoint } from "@/lib/geo/types";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import {
  finalizeFare,
  formatTariffCop,
  resolveCityTariff,
} from "@/lib/tariff";
import {
  clearTaximeterSession,
  getTaximeterSession,
  insertTaximeterTestRun,
  upsertTaximeterSession,
} from "@/lib/taximeter-test/store";
import type {
  TaximeterPickupType,
  TaximeterRouteSnapshot,
  TaximeterTestSession,
} from "@/lib/taximeter-test/types";
import {
  PRICING_ENGINE_VERSION,
  ROUTE_PROVIDER_GOOGLE,
  ROUTE_PROVIDER_HAVERSINE,
} from "@/lib/taximeter-test/types";
import {
  sendButtonsMessage,
  sendLocationRequestMessage,
  sendTextMessage,
} from "@/lib/whatsapp/client";

export const TAXIMETER_BUTTON_IDS = {
  SEND_LOCATION: "taximeter_send_location",
  FINISH: "taximeter_finish",
  CALLE: "taximeter_calle",
  SATELITAL: "taximeter_satelital",
} as const;

const ACTIVATION_EMOJI = "🚖";

const ACTIVATION_BODY = [
  "✅ Taxímetro de prueba activado.",
  "Comparte tu ubicación para iniciar la medición o presiona 🏁 Terminar si finalmente no vas a realizar el recorrido.",
].join("\n");

const START_LOCATION_PROMPT =
  "📍 Comparte tu ubicación para iniciar la medición del taxímetro de prueba.";

const END_LOCATION_PROMPT =
  "📍 Comparte tu ubicación actual para finalizar la medición.";

const MEASURING_BODY = [
  "📍 Inicio registrado.",
  "Realiza el recorrido y cuando finalices presiona 🏁 Terminar.",
].join("\n");

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Trigger: solo el emoji 🚖. */
export function isTaximeterActivationText(text: string | null): boolean {
  if (!text) {
    return false;
  }
  return text.trim() === ACTIVATION_EMOJI;
}

export function isTaximeterButton(button: string | null): boolean {
  if (!button) {
    return false;
  }
  return (
    button === TAXIMETER_BUTTON_IDS.SEND_LOCATION ||
    button === TAXIMETER_BUTTON_IDS.FINISH ||
    button === TAXIMETER_BUTTON_IDS.CALLE ||
    button === TAXIMETER_BUTTON_IDS.SATELITAL
  );
}

export function parseMeterValue(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/\$/g, "")
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) {
    return null;
  }
  return n;
}

function hasStartedMeasurement(session: TaximeterTestSession): boolean {
  return (
    session.startLat != null &&
    session.startLng != null &&
    Boolean(session.startedAt)
  );
}

async function askStartLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, START_LOCATION_PROMPT);
}

async function askEndLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, END_LOCATION_PROMPT);
}

async function sendActivationPrompt(phone: string): Promise<void> {
  await sendButtonsMessage(phone, ACTIVATION_BODY, [
    { id: TAXIMETER_BUTTON_IDS.SEND_LOCATION, title: "📍 Enviar ubicación" },
    { id: TAXIMETER_BUTTON_IDS.FINISH, title: "🏁 Terminar" },
  ]);
}

async function sendMeasuringWithFinish(phone: string): Promise<void> {
  await sendButtonsMessage(phone, MEASURING_BODY, [
    { id: TAXIMETER_BUTTON_IDS.FINISH, title: "🏁 Terminar" },
  ]);
}

async function cancelBeforeStart(phone: string): Promise<void> {
  await clearTaximeterSession(phone);
  await sendTextMessage(phone, "✅ Taxímetro de prueba cancelado.");
  console.log("[taximeter-test] cancelado antes de iniciar", { phone });
}

/**
 * Activa el modo pendiente (sin medición). La corrida solo nace al compartir
 * el pin de inicio; si cancela, se borra la marca pendiente sin runs.
 */
export async function startTaximeterTest(
  phone: string,
  driver: { id: string; name: string | null },
): Promise<void> {
  await upsertTaximeterSession(phone, {
    driverId: driver.id,
    driverName: driver.name,
    state: "awaiting_start_location",
    startedAt: null,
    startLat: null,
    startLng: null,
    endLat: null,
    endLng: null,
    finishedAt: null,
    distanceMeters: null,
    durationSeconds: null,
    whatxiaFare: null,
    meterValue: null,
    routeProvider: null,
    routePolyline: null,
    route: null,
  });

  await sendActivationPrompt(phone);

  console.log("[taximeter-test] activado (pendiente de inicio)", {
    phone,
    driverId: driver.id,
  });
}

async function beginMeasurement(
  phone: string,
  session: TaximeterTestSession,
  point: GeoPoint,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const startPoint = { lat: point.lat, lng: point.lng, at: startedAt };

  await upsertTaximeterSession(phone, {
    driverId: session.driverId,
    driverName: session.driverName,
    state: "measuring",
    startLat: point.lat,
    startLng: point.lng,
    startedAt,
    endLat: null,
    endLng: null,
    finishedAt: null,
    distanceMeters: null,
    durationSeconds: null,
    whatxiaFare: null,
    meterValue: null,
    routeProvider: null,
    routePolyline: null,
    route: {
      provider: ROUTE_PROVIDER_GOOGLE,
      origin: { lat: startPoint.lat, lng: startPoint.lng },
      destination: { lat: startPoint.lat, lng: startPoint.lng },
      distanceMeters: 0,
      durationSecondsWall: 0,
      durationSecondsRoute: null,
      polylineEncoded: null,
      fallback: null,
      trackPoints: [startPoint],
    },
  });

  await sendMeasuringWithFinish(phone);
  console.log("[taximeter-test] medición iniciada", {
    phone,
    startLat: startPoint.lat,
    startLng: startPoint.lng,
  });
}

async function completeMeasurement(
  phone: string,
  session: TaximeterTestSession,
  end: GeoPoint,
): Promise<void> {
  if (!hasStartedMeasurement(session)) {
    await sendActivationPrompt(phone);
    await upsertTaximeterSession(phone, { state: "awaiting_start_location" });
    return;
  }

  const start: GeoPoint = { lat: session.startLat!, lng: session.startLng! };
  const finishedAt = new Date();
  const startedAt = new Date(session.startedAt!);
  const wallSeconds = Math.max(
    1,
    Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
  );

  let distanceMeters = haversineMeters(start, end);
  let durationSeconds = wallSeconds;
  let routeProvider = ROUTE_PROVIDER_HAVERSINE;
  let routePolyline: string | null = null;
  let durationSecondsRoute: number | null = null;
  let fallback: "haversine" | null = "haversine";

  try {
    const route = await estimateRoute(start, end);
    distanceMeters = route.distanceMeters;
    durationSeconds = wallSeconds;
    durationSecondsRoute = route.durationSeconds;
    routePolyline = route.polylineEncoded ?? null;
    routeProvider = ROUTE_PROVIDER_GOOGLE;
    fallback = null;
  } catch (error) {
    console.warn("[taximeter-test] Routes falló; usando haversine:", error);
  }

  const routeSnapshot: TaximeterRouteSnapshot = {
    provider: routeProvider,
    origin: { lat: start.lat, lng: start.lng },
    destination: { lat: end.lat, lng: end.lng },
    distanceMeters,
    durationSecondsWall: wallSeconds,
    durationSecondsRoute,
    polylineEncoded: routePolyline,
    fallback,
    trackPoints: [
      ...(session.route?.trackPoints ?? []),
      { lat: end.lat, lng: end.lng, at: finishedAt.toISOString() },
    ],
  };

  const city = await getActiveCity();
  let whatxiaFare: number;
  try {
    const quote = await finalizeFare({
      citySlug: city.slug,
      origin: { lat: start.lat, lng: start.lng, label: "Inicio prueba" },
      destination: { lat: end.lat, lng: end.lng, label: "Fin prueba" },
      distanceMeters,
      durationSeconds,
      startedAt,
      finishedAt,
      deriveWaitFromSpeed: true,
    });
    whatxiaFare = quote.amount;
  } catch (error) {
    console.error("[taximeter-test] finalizeFare error:", error);
    await sendTextMessage(
      phone,
      "No pudimos calcular la tarifa WhatXia. Intenta de nuevo el recorrido.",
    );
    await clearTaximeterSession(phone);
    return;
  }

  await upsertTaximeterSession(phone, {
    state: "awaiting_meter_value",
    endLat: end.lat,
    endLng: end.lng,
    finishedAt: finishedAt.toISOString(),
    distanceMeters,
    durationSeconds,
    whatxiaFare,
    routeProvider,
    routePolyline,
    route: routeSnapshot,
  });

  await sendTextMessage(
    phone,
    [
      `💰 Tarifa WhatXia: ${formatTariffCop(whatxiaFare)}`,
      "¿Cuál fue el valor que marcó el taxímetro?",
    ].join("\n"),
  );
}

async function askServiceType(phone: string): Promise<void> {
  await sendButtonsMessage(phone, "Tipo de servicio:", [
    { id: TAXIMETER_BUTTON_IDS.CALLE, title: "🚕 Calle" },
    { id: TAXIMETER_BUTTON_IDS.SATELITAL, title: "📱 Satelital" },
  ]);
}

async function persistRun(
  phone: string,
  session: TaximeterTestSession,
  pickupType: TaximeterPickupType,
): Promise<void> {
  if (
    session.startLat == null ||
    session.startLng == null ||
    session.endLat == null ||
    session.endLng == null ||
    !session.startedAt ||
    !session.finishedAt ||
    session.distanceMeters == null ||
    session.durationSeconds == null ||
    session.whatxiaFare == null ||
    session.meterValue == null
  ) {
    await sendTextMessage(phone, "Datos incompletos. Envía 🚖 para reiniciar.");
    await clearTaximeterSession(phone);
    return;
  }

  const differencePesos = session.meterValue - session.whatxiaFare;
  const differencePercent =
    session.whatxiaFare === 0
      ? 0
      : (differencePesos / session.whatxiaFare) * 100;

  const city = await getActiveCity();
  let pickupSurcharge = 0;
  try {
    const tariff = await resolveCityTariff(city.slug);
    pickupSurcharge =
      pickupType === "satelital" ? tariff.surcharges.platform : 0;
  } catch (error) {
    console.warn(
      "[taximeter-test] no se pudo leer recargo de fare_rules; satelital=800 fallback",
      error,
    );
    pickupSurcharge = pickupType === "satelital" ? 800 : 0;
  }

  const routeSnapshot: TaximeterRouteSnapshot = session.route ?? {
    provider: session.routeProvider ?? ROUTE_PROVIDER_HAVERSINE,
    origin: { lat: session.startLat, lng: session.startLng },
    destination: { lat: session.endLat, lng: session.endLng },
    distanceMeters: session.distanceMeters,
    durationSecondsWall: session.durationSeconds,
    durationSecondsRoute: null,
    polylineEncoded: session.routePolyline,
    fallback:
      session.routeProvider === ROUTE_PROVIDER_GOOGLE ? null : "haversine",
  };

  await insertTaximeterTestRun({
    driverId: session.driverId,
    driverPhone: phone,
    driverName: session.driverName,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    startLat: session.startLat,
    startLng: session.startLng,
    endLat: session.endLat,
    endLng: session.endLng,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
    whatxiaFare: session.whatxiaFare,
    meterValue: session.meterValue,
    differencePesos,
    differencePercent: Math.round(differencePercent * 10000) / 10000,
    pickupType,
    pickupSurcharge,
    routeProvider: session.routeProvider ?? routeSnapshot.provider,
    pricingEngineVersion: PRICING_ENGINE_VERSION,
    routePolyline: session.routePolyline ?? routeSnapshot.polylineEncoded,
    route: routeSnapshot,
    citySlug: city.slug,
  });

  await clearTaximeterSession(phone);

  await sendTextMessage(
    phone,
    ["✅ Prueba registrada correctamente.", "Gracias por tu tiempo."].join(
      "\n",
    ),
  );

  console.log("[taximeter-test] corrida guardada", {
    phone,
    whatxiaFare: session.whatxiaFare,
    meterValue: session.meterValue,
    pickupType,
    pickupSurcharge,
    routeProvider: session.routeProvider,
    pricingEngineVersion: PRICING_ENGINE_VERSION,
    differencePesos,
  });
}

/**
 * Maneja mensajes del taxímetro de prueba.
 * @returns true si consumió el mensaje (no pasar a Mobility).
 */
export async function handleTaximeterMessage(
  message: IncomingMessage,
): Promise<boolean> {
  const phone = message.phone;
  const session = await getTaximeterSession(phone);

  // Activación 🚖
  if (isTaximeterActivationText(message.text)) {
    const driver = await findDriverByPhone(phone);
    if (!driver) {
      return false;
    }
    await startTaximeterTest(phone, {
      id: driver.id,
      name: driver.name ?? null,
    });
    return true;
  }

  if (!session) {
    if (isTaximeterButton(message.button)) {
      await sendTextMessage(
        phone,
        "No hay un taxímetro de prueba activo. Envía 🚖 para iniciar.",
      );
      return true;
    }
    return false;
  }

  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await clearTaximeterSession(phone);
    return false;
  }

  // Botón 📍 Enviar ubicación → location_request nativo de WhatsApp
  if (message.button === TAXIMETER_BUTTON_IDS.SEND_LOCATION) {
    if (hasStartedMeasurement(session)) {
      await sendMeasuringWithFinish(phone);
      return true;
    }
    await upsertTaximeterSession(phone, { state: "awaiting_start_location" });
    await askStartLocation(phone);
    return true;
  }

  // Ubicación de inicio → aquí nace la medición / sesión real
  if (
    message.location &&
    (session.state === "awaiting_start_location" ||
      (session.state === "measuring" && !hasStartedMeasurement(session)))
  ) {
    await beginMeasurement(phone, session, {
      lat: message.location.lat,
      lng: message.location.lng,
    });
    return true;
  }

  // Botón 🏁 Terminar
  if (message.button === TAXIMETER_BUTTON_IDS.FINISH) {
    if (!hasStartedMeasurement(session)) {
      await cancelBeforeStart(phone);
      return true;
    }
    await upsertTaximeterSession(phone, { state: "awaiting_end_location" });
    await askEndLocation(phone);
    return true;
  }

  // Ubicación final
  if (message.location && session.state === "awaiting_end_location") {
    await completeMeasurement(phone, session, {
      lat: message.location.lat,
      lng: message.location.lng,
    });
    return true;
  }

  // Durante medición: ubicaciones extra no cierran el recorrido
  if (message.location && session.state === "measuring") {
    await sendMeasuringWithFinish(phone);
    return true;
  }

  // Valor del taxímetro
  if (session.state === "awaiting_meter_value" && message.text) {
    const value = parseMeterValue(message.text);
    if (value == null) {
      await sendTextMessage(
        phone,
        "Envía solo el valor numérico del taxímetro (ejemplo: 14700).",
      );
      return true;
    }
    await upsertTaximeterSession(phone, {
      state: "awaiting_service_type",
      meterValue: value,
    });
    await askServiceType(phone);
    return true;
  }

  // Tipo de servicio
  if (session.state === "awaiting_service_type") {
    const fresh = await getTaximeterSession(phone);
    if (!fresh) {
      await sendTextMessage(phone, "Sesión expirada. Envía 🚖 para reiniciar.");
      return true;
    }
    if (message.button === TAXIMETER_BUTTON_IDS.CALLE) {
      await persistRun(phone, fresh, "calle");
      return true;
    }
    if (message.button === TAXIMETER_BUTTON_IDS.SATELITAL) {
      await persistRun(phone, fresh, "satelital");
      return true;
    }
    await askServiceType(phone);
    return true;
  }

  // Reorientar según estado
  if (session.state === "awaiting_start_location") {
    await sendActivationPrompt(phone);
    return true;
  }
  if (session.state === "measuring") {
    await sendMeasuringWithFinish(phone);
    return true;
  }
  if (session.state === "awaiting_end_location") {
    await askEndLocation(phone);
    return true;
  }
  if (session.state === "awaiting_meter_value") {
    await sendTextMessage(
      phone,
      "¿Cuál fue el valor que marcó el taxímetro? (solo números)",
    );
    return true;
  }

  return true;
}
