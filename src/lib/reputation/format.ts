/**
 * Textos de reputación para WhatsApp (conductores y pasajeros).
 */

import {
  formatAverageScore,
  type RatingAggregate,
} from "@/lib/reputation/average";

/** Promedio genérico: "⭐ 4.8 / 5.0" o "⭐ Usuario nuevo." */
export function formatUserAverageLine(aggregate: RatingAggregate): string {
  if (aggregate.average == null) {
    return "⭐ Usuario nuevo.";
  }
  return `⭐ ${formatAverageScore(aggregate.average)}`;
}

/** En oferta a conductores. */
export function formatPassengerReputationForOffer(
  aggregate: RatingAggregate,
): string {
  if (aggregate.average == null) {
    return "⭐ Pasajero nuevo.";
  }
  return `⭐ Pasajero: ${formatAverageScore(aggregate.average)}`;
}

/** Al aceptar: mensaje al pasajero. */
export function formatDriverReputationForPassenger(
  aggregate: RatingAggregate,
): string {
  if (aggregate.average == null) {
    return "⭐ Conductor nuevo.";
  }
  return `⭐ Calificación: ${formatAverageScore(aggregate.average)}`;
}
