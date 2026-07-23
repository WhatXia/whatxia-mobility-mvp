/**
 * Taxímetro de prueba — flujo WhatsApp independiente de Mobility.
 * No crea trips, no despacha, no usa booking.
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
  FINISH: "taximeter_finish",
  CALLE: "taximeter_calle",
  SATELITAL: "taximeter_satelital",
} as const;

const ACTIVATION_EMOJI = "🚖";

const ACTIVATION_BODY = [
  "✅ Taxímetro de prueba activado.",
  "La medición comenzó desde tu ubicación actual.",
  "Cuando finalices el recorrido, presiona 🏁 Terminar.",
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

async function askStartLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(
    phone,
    "📍 Comparte tu ubicación de inicio para el taxímetro de prueba.",
  );
}

async function askEndLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(
    phone,
    "📍 Comparte tu ubicación final para cerrar la medición.",
  );
}

async function sendActivationWithFinish(phone: string): Promise<void> {
  await sendButtonsMessage(phone, ACTIVATION_BODY, [
    { id: TAXIMETER_BUTTON_IDS.FINISH, title: "🏁 Terminar" },
  ]);
}

export async function startTaximeterTest(
  phone: string,
  driver: { id: string; name: string | null },
): Promise<void> {
  await upsertTaximeterSession(phone, {
    driverId: driver.id,
    driverName: driver.name,
    state: "awaiting_start_location",
    startedAt: new Date().toISOString(),
    startLat: null,
    startLng: null,
    endLat: null,
    endLng: null,
    finishedAt: null,
    distanceMeters: null,
    durationSeconds: null,
    whatxiaFare: null,
    meterValue: null,
  });

  await sendActivationWithFinish(phone);
  await askStartLocation(phone);

  console.log("[taximeter-test] activado", {
    phone,
    driverId: driver.id,
  });
}

async function completeMeasurement(
  phone: string,
  session: TaximeterTestSession,
  end: GeoPoint,
): Promise<void> {
  if (session.startLat == null || session.startLng == null || !session.startedAt) {
    await sendTextMessage(
      phone,
      "Falta la ubicación de inicio. Compártela para continuar.",
    );
    await askStartLocation(phone);
    await upsertTaximeterSession(phone, { state: "awaiting_start_location" });
    return;
  }

  const start: GeoPoint = { lat: session.startLat, lng: session.startLng };
  const finishedAt = new Date();
  const startedAt = new Date(session.startedAt);
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
      "✅ Recorrido finalizado.",
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
    [
      "✅ Prueba registrada correctamente.",
      "El taxímetro de prueba ha sido cerrado.",
      "",
      "Para una nueva prueba, envía nuevamente 🚖.",
    ].join("\n"),
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

  // Solo conductores con sesión activa
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await clearTaximeterSession(phone);
    return false;
  }

  // Ubicación de inicio
  if (
    message.location &&
    (session.state === "awaiting_start_location" ||
      (session.state === "measuring" && session.startLat == null))
  ) {
    await upsertTaximeterSession(phone, {
      state: "measuring",
      startLat: message.location.lat,
      startLng: message.location.lng,
      startedAt: session.startedAt ?? new Date().toISOString(),
    });
    await sendTextMessage(
      phone,
      "📍 Inicio registrado. Realiza el recorrido y presiona 🏁 Terminar.",
    );
    return true;
  }

  // Botón Terminar
  if (message.button === TAXIMETER_BUTTON_IDS.FINISH) {
    if (session.startLat == null || session.startLng == null) {
      await upsertTaximeterSession(phone, { state: "awaiting_start_location" });
      await sendTextMessage(
        phone,
        "Primero comparte la ubicación de inicio.",
      );
      await askStartLocation(phone);
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

  // Cualquier otro mensaje con sesión activa: reorientar
  if (session.state === "awaiting_start_location") {
    await askStartLocation(phone);
    return true;
  }
  if (session.state === "measuring") {
    await sendButtonsMessage(
      phone,
      "Taxímetro de prueba en curso. Cuando termines el recorrido:",
      [{ id: TAXIMETER_BUTTON_IDS.FINISH, title: "🏁 Terminar" }],
    );
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
