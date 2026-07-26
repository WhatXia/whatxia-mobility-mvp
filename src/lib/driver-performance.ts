/**
 * Módulo "Mi rendimiento" del conductor.
 *
 * Fase actual: servicios (mes/año) + promedio de calificación + recomendación.
 * Extensible para: ingresos, aceptación, cancelaciones, ETA, ranking.
 */

import { getSupabase } from "@/lib/supabase/client";
import { getAuthenticatedDriver } from "@/lib/driver-auth-session";
import { DRIVER_MENU_IDS } from "@/lib/driver-menu";
import { getDriverRatingAggregate } from "@/lib/reputation";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";


/** Zona horaria operativa WhatXia (Colombia). */
const TZ = "America/Bogota";

/**
 * Stats actuales + huecos tipados para métricas futuras
 * (sin valores simulados en esta fase).
 */
export type DriverPerformanceStats = {
  driverId: string;
  driverName: string;
  servicesThisMonth: number;
  servicesThisYear: number;
  /** Promedio 1 decimal; null si no hay calificaciones. */
  averageRating: number | null;
  ratingsCount: number;
  // —— Preparación métricas futuras (no calculadas aún) ——
  monthEarnings: null;
  acceptanceRate: null;
  cancellationRate: null;
  averageArrivalMinutes: null;
  rankingPosition: null;
};

export type PerformanceRecommendationTier =
  | "excellent"
  | "improve"
  | "critical"
  | "none";

function bogotaParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

/** Inicio del mes en Bogotá como ISO (UTC) aproximado para filtros. */
export function startOfMonthBogotaIso(now = new Date()): string {
  const { year, month } = bogotaParts(now);
  // Medianoche Bogotá = 05:00 UTC
  return new Date(Date.UTC(year, month - 1, 1, 5, 0, 0)).toISOString();
}

export function startOfYearBogotaIso(now = new Date()): string {
  const { year } = bogotaParts(now);
  return new Date(Date.UTC(year, 0, 1, 5, 0, 0)).toISOString();
}

async function countCompletedServices(
  driverId: string,
  finishedAtFrom: string,
): Promise<number> {
  const supabase = getSupabase();

  const { count, error } = await supabase
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .eq("status", "COMPLETED")
    .gte("finished_at", finishedAtFrom);

  if (error) {
    console.error("[driver-performance] error al contar servicios:", error);
    throw error;
  }

  return count ?? 0;
}

export async function getDriverPerformanceStats(
  driverId: string,
  driverName: string,
): Promise<DriverPerformanceStats> {
  const monthFrom = startOfMonthBogotaIso();
  const yearFrom = startOfYearBogotaIso();

  const [servicesThisMonth, servicesThisYear, ratingAgg] = await Promise.all([
    countCompletedServices(driverId, monthFrom),
    countCompletedServices(driverId, yearFrom),
    getDriverRatingAggregate(driverId),
  ]);

  return {
    driverId,
    driverName,
    servicesThisMonth,
    servicesThisYear,
    averageRating: ratingAgg.average,
    ratingsCount: ratingAgg.count,
    monthEarnings: null,
    acceptanceRate: null,
    cancellationRate: null,
    averageArrivalMinutes: null,
    rankingPosition: null,
  };
}

export function getPerformanceRecommendationTier(
  averageRating: number | null,
): PerformanceRecommendationTier {
  if (averageRating === null) {
    return "none";
  }
  if (averageRating >= 4.5) {
    return "excellent";
  }
  if (averageRating >= 4.0) {
    return "improve";
  }
  return "critical";
}

export function formatPerformanceRecommendation(
  tier: PerformanceRecommendationTier,
): string | null {
  if (tier === "excellent") {
    return [
      "🎉 ¡Excelente trabajo!",
      "Continúa brindando un servicio de alta calidad.",
    ].join("\n");
  }

  if (tier === "improve") {
    return [
      "⚠️ Te recomendamos mejorar tu promedio de calificación.",
      "Nuestro objetivo es brindar un servicio de excelencia a todos los usuarios.",
    ].join("\n");
  }

  if (tier === "critical") {
    return [
      "🚨 Tu promedio de calificación está por debajo del estándar de calidad de WhatXia.",
      "",
      "Dispones de 30 días para mejorar tu desempeño.",
      "",
      "Si al finalizar ese período no alcanzas el promedio mínimo requerido, tu caso será revisado por el equipo de operaciones y podrán aplicarse las medidas establecidas en el reglamento de conductores.",
    ].join("\n");
  }

  return null;
}

export function formatPerformanceMessage(stats: DriverPerformanceStats): string {
  const ratingLine =
    stats.averageRating === null
      ? "⭐ Calificación promedio: Sin calificaciones aún."
      : `⭐ Calificación promedio: ${stats.averageRating.toFixed(1)} / 5.0`;

  const lines = [
    `Hola, ${stats.driverName}. 👋`,
    "",
    "📊 Tu rendimiento",
    "",
    `🚕 Servicios realizados este mes: ${stats.servicesThisMonth}`,
    `🚕 Servicios realizados este año: ${stats.servicesThisYear}`,
    ratingLine,
  ];

  const recommendation = formatPerformanceRecommendation(
    getPerformanceRecommendationTier(stats.averageRating),
  );

  if (recommendation) {
    lines.push("", recommendation);
  }

  return lines.join("\n");
}

/** Entrada desde el botón Mi rendimiento (conductor autenticado). */
export async function handleDriverPerformance(phone: string): Promise<void> {
  const driver = await getAuthenticatedDriver(phone);

  if (!driver) {
    await sendTextMessage(
      phone,
      "Debes iniciar sesión para ver tu rendimiento.",
    );
    return;
  }

  const stats = await getDriverPerformanceStats(driver.id, driver.name);
  const body = formatPerformanceMessage(stats);

  await sendButtonsMessage(phone, body, [
    {
      id: DRIVER_MENU_IDS.VOLVER_PERFIL,
      title: "⬅️ Volver",
    },
  ]);

  console.log("[driver-performance]", {
    driverId: stats.driverId,
    servicesThisMonth: stats.servicesThisMonth,
    servicesThisYear: stats.servicesThisYear,
    averageRating: stats.averageRating,
    ratingsCount: stats.ratingsCount,
  });
}
