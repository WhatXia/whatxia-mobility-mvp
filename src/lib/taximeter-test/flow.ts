/**
 * Taxímetro de prueba — MVP simplificado (independiente de Mobility).
 * Flujo: 🚖 → pin inicio → pin fin → confirmar → Calle/Satelital → guardar.
 * No pide valor del taxímetro físico.
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
  newTaximeterSessionId,
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
  CONFIRM_FINISH: "taximeter_confirm_finish",
  CALLE: "taximeter_calle",
  SATELITAL: "taximeter_satelital",
} as const;

const ACTIVATION_EMOJI = "🚖";

const ACTIVATION_LOCATION_BODY = [
  "✅ Taxímetro de prueba activado.",
  "Comparte tu ubicación inicial para comenzar.",
].join("\n");

const AFTER_START_BODY = [
  "📍 Inicio registrado.",
  "Cuando finalices el recorrido, comparte tu ubicación final.",
].join("\n");

const CONFIRM_FINISH_BODY = "¿Confirmas que el recorrido ha terminado?";

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
    button === TAXIMETER_BUTTON_IDS.CONFIRM_FINISH ||
    button === TAXIMETER_BUTTON_IDS.CALLE ||
    button === TAXIMETER_BUTTON_IDS.SATELITAL
  );
}

async function askStartLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, ACTIVATION_LOCATION_BODY);
}

async function askEndLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, AFTER_START_BODY);
}

async function askConfirmFinish(phone: string): Promise<void> {
  await sendButtonsMessage(phone, CONFIRM_FINISH_BODY, [
    { id: TAXIMETER_BUTTON_IDS.CONFIRM_FINISH, title: "✅ Terminar recorrido" },
  ]);
}

async function askServiceType(phone: string, whatxiaFare: number): Promise<void> {
  await sendButtonsMessage(
    phone,
    [
      `💰 Tarifa WhatXia: ${formatTariffCop(whatxiaFare)}`,
      "¿Cómo fue tomado el servicio?",
    ].join("\n"),
    [
      { id: TAXIMETER_BUTTON_IDS.CALLE, title: "🚕 Calle" },
      { id: TAXIMETER_BUTTON_IDS.SATELITAL, title: "📱 Satelital" },
    ],
  );
}

export async function startTaximeterTest(
  phone: string,
  driver: { id: string; name: string | null },
): Promise<void> {
  const sessionId = newTaximeterSessionId();

  await upsertTaximeterSession(phone, {
    sessionId,
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

  await askStartLocation(phone);

  console.log("[taximeter-test] activado", {
    phone,
    driverId: driver.id,
    sessionId,
  });
}

async function registerStart(
  phone: string,
  session: TaximeterTestSession,
  point: GeoPoint,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const sessionId = session.sessionId ?? newTaximeterSessionId();

  await upsertTaximeterSession(phone, {
    sessionId,
    driverId: session.driverId,
    driverName: session.driverName,
    state: "awaiting_end_location",
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
    route: null,
  });

  await askEndLocation(phone);

  console.log("[taximeter-test] inicio registrado", {
    phone,
    sessionId,
    startLat: point.lat,
    startLng: point.lng,
    startedAt,
  });
}

async function registerEnd(
  phone: string,
  session: TaximeterTestSession,
  point: GeoPoint,
): Promise<void> {
  await upsertTaximeterSession(phone, {
    sessionId: session.sessionId,
    state: "awaiting_confirm_finish",
    endLat: point.lat,
    endLng: point.lng,
  });

  await askConfirmFinish(phone);

  console.log("[taximeter-test] fin registrado — pendiente confirmación", {
    phone,
    sessionId: session.sessionId,
    endLat: point.lat,
    endLng: point.lng,
  });
}

async function computeAndAskServiceType(
  phone: string,
  session: TaximeterTestSession,
): Promise<void> {
  if (
    session.startLat == null ||
    session.startLng == null ||
    session.endLat == null ||
    session.endLng == null ||
    !session.startedAt
  ) {
    await sendTextMessage(
      phone,
      "Faltan datos del recorrido. Envía 🚖 para reiniciar.",
    );
    await clearTaximeterSession(phone);
    return;
  }

  const start: GeoPoint = { lat: session.startLat, lng: session.startLng };
  const end: GeoPoint = { lat: session.endLat, lng: session.endLng };
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
      "No pudimos calcular la tarifa WhatXia. Envía 🚖 para reiniciar.",
    );
    await clearTaximeterSession(phone);
    return;
  }

  await upsertTaximeterSession(phone, {
    sessionId: session.sessionId,
    state: "awaiting_service_type",
    finishedAt: finishedAt.toISOString(),
    distanceMeters,
    durationSeconds,
    whatxiaFare,
    routeProvider,
    routePolyline,
    route: routeSnapshot,
  });

  await askServiceType(phone, whatxiaFare);
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
    session.whatxiaFare == null
  ) {
    await sendTextMessage(phone, "Datos incompletos. Envía 🚖 para reiniciar.");
    await clearTaximeterSession(phone);
    return;
  }

  const city = await getActiveCity();
  let pickupSurcharge = 0;
  try {
    const tariff = await resolveCityTariff(city.slug);
    pickupSurcharge =
      pickupType === "satelital" ? tariff.surcharges.platform : 0;
  } catch (error) {
    console.warn(
      "[taximeter-test] no se pudo leer recargo; satelital=800 fallback",
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
    meterValue: null,
    differencePesos: null,
    differencePercent: null,
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
    sessionId: session.sessionId,
    whatxiaFare: session.whatxiaFare,
    pickupType,
    routeProvider: session.routeProvider,
  });
}

/**
 * Maneja mensajes del taxímetro de prueba.
 * Fuente de verdad: session.state.
 * @returns true si consumió el mensaje (no pasar a Mobility).
 */
export async function handleTaximeterMessage(
  message: IncomingMessage,
): Promise<boolean> {
  const phone = message.phone;
  const session = await getTaximeterSession(phone);

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

  switch (session.state) {
    case "awaiting_start_location": {
      if (message.location) {
        await registerStart(phone, session, {
          lat: message.location.lat,
          lng: message.location.lng,
        });
        return true;
      }
      await askStartLocation(phone);
      return true;
    }

    case "awaiting_end_location": {
      if (message.location) {
        await registerEnd(phone, session, {
          lat: message.location.lat,
          lng: message.location.lng,
        });
        return true;
      }
      await askEndLocation(phone);
      return true;
    }

    case "awaiting_confirm_finish": {
      if (message.button === TAXIMETER_BUTTON_IDS.CONFIRM_FINISH) {
        await computeAndAskServiceType(phone, session);
        return true;
      }
      if (message.location) {
        // Nuevo pin final reemplaza el anterior.
        await registerEnd(phone, session, {
          lat: message.location.lat,
          lng: message.location.lng,
        });
        return true;
      }
      await askConfirmFinish(phone);
      return true;
    }

    case "awaiting_service_type": {
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
      if (fresh.whatxiaFare != null) {
        await askServiceType(phone, fresh.whatxiaFare);
      }
      return true;
    }

    default: {
      await clearTaximeterSession(phone);
      await sendTextMessage(phone, "Sesión inválida. Envía 🚖 para reiniciar.");
      return true;
    }
  }
}
