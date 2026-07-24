/**
 * Taxímetro de prueba — captura valor físico vs WhatXia.
 * Flujo: 🚖 → pin inicio → 🏁 Terminar → pin fin → tarifa → valor taxímetro → guardar.
 * Independiente de Mobility / trips.
 */

import type { IncomingMessage } from "@/types";
import { getActiveCity } from "@/lib/city/context";
import { estimateRoute } from "@/lib/geo/routes";
import type { GeoPoint } from "@/lib/geo/types";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import { finalizeFare, formatTariffCop } from "@/lib/tariff";
import {
  clearTaximeterSession,
  getTaximeterSession,
  insertTaximeterTestRun,
  newTaximeterSessionId,
  upsertTaximeterSession,
} from "@/lib/taximeter-test/store";
import type {
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
} as const;

const ACTIVATION_EMOJI = "🚖";

const ACTIVATION_LOCATION_BODY = [
  "✅ Taxímetro de prueba activado.",
  "Comparte tu ubicación de inicio.",
].join("\n");

const END_LOCATION_BODY =
  "📍 Comparte tu ubicación final para cerrar la medición.";

const MEASURING_BODY = "✅ Ubicación de inicio registrada.";

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
  return button === TAXIMETER_BUTTON_IDS.FINISH;
}

/** Parsea valor del taxímetro físico (entero COP). */
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
  await sendLocationRequestMessage(phone, ACTIVATION_LOCATION_BODY);
}

async function askEndLocation(phone: string): Promise<void> {
  await sendLocationRequestMessage(phone, END_LOCATION_BODY);
}

async function sendMeasuringWithFinish(phone: string): Promise<void> {
  await sendButtonsMessage(phone, MEASURING_BODY, [
    { id: TAXIMETER_BUTTON_IDS.FINISH, title: "🏁 Terminar prueba" },
  ]);
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
    route: null,
  });

  await sendMeasuringWithFinish(phone);

  console.log("[taximeter-test] inicio registrado", {
    phone,
    sessionId,
    startLat: point.lat,
    startLng: point.lng,
    startedAt,
  });
}

async function completeWithEndLocation(
  phone: string,
  session: TaximeterTestSession,
  end: GeoPoint,
): Promise<void> {
  if (
    session.startLat == null ||
    session.startLng == null ||
    !session.startedAt
  ) {
    await sendTextMessage(
      phone,
      "Falta la ubicación de inicio. Envía 🚖 para reiniciar.",
    );
    await clearTaximeterSession(phone);
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
      `Valor calculado por WhatXia: ${formatTariffCop(whatxiaFare)}`,
      "¿Cuál fue el valor que marcó el taxímetro?",
    ].join("\n"),
  );

  console.log("[taximeter-test] tarifa calculada — esperando valor taxímetro", {
    phone,
    sessionId: session.sessionId,
    whatxiaFare,
    distanceMeters,
    durationSeconds,
  });
}

async function persistRun(
  phone: string,
  session: TaximeterTestSession,
  meterValue: number,
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

  const differencePesos = meterValue - session.whatxiaFare;
  const differencePercent =
    session.whatxiaFare === 0
      ? 0
      : Math.round((differencePesos / session.whatxiaFare) * 10000) / 10000;

  const city = await getActiveCity();

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
    meterValue,
    differencePesos,
    differencePercent,
    // No se pregunta Calle/Satelital en este flujo; default neutro.
    pickupType: "calle",
    pickupSurcharge: 0,
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
      `WhatXia: ${formatTariffCop(session.whatxiaFare)}`,
      `Taxímetro: ${formatTariffCop(meterValue)}`,
      `Diferencia: ${formatTariffCop(Math.abs(differencePesos))}${differencePesos >= 0 ? " (taxímetro ≥ WhatXia)" : " (WhatXia ≥ taxímetro)"}`,
      "Gracias por tu tiempo.",
    ].join("\n"),
  );

  console.log("[taximeter-test] corrida guardada", {
    phone,
    sessionId: session.sessionId,
    whatxiaFare: session.whatxiaFare,
    meterValue,
    differencePesos,
    differencePercent,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
  });
}

/**
 * Maneja mensajes del taxímetro de prueba.
 * Fuente de verdad: session.state.
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

    case "measuring": {
      if (message.button === TAXIMETER_BUTTON_IDS.FINISH) {
        await upsertTaximeterSession(phone, {
          sessionId: session.sessionId,
          state: "awaiting_end_location",
        });
        await askEndLocation(phone);
        return true;
      }
      await sendMeasuringWithFinish(phone);
      return true;
    }

    case "awaiting_end_location": {
      if (message.location) {
        await completeWithEndLocation(phone, session, {
          lat: message.location.lat,
          lng: message.location.lng,
        });
        return true;
      }
      await askEndLocation(phone);
      return true;
    }

    case "awaiting_meter_value": {
      if (!message.text) {
        await sendTextMessage(
          phone,
          "¿Cuál fue el valor que marcó el taxímetro? (solo números)",
        );
        return true;
      }
      const meterValue = parseMeterValue(message.text);
      if (meterValue == null) {
        await sendTextMessage(
          phone,
          "Envía solo el valor numérico del taxímetro (ejemplo: 14700).",
        );
        return true;
      }
      const fresh = await getTaximeterSession(phone);
      if (!fresh) {
        await sendTextMessage(phone, "Sesión expirada. Envía 🚖 para reiniciar.");
        return true;
      }
      await persistRun(phone, fresh, meterValue);
      return true;
    }

    default: {
      await clearTaximeterSession(phone);
      await sendTextMessage(phone, "Sesión inválida. Envía 🚖 para reiniciar.");
      return true;
    }
  }
}
