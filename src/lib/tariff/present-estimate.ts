/**
 * Presentación de tarifa estimada (no altera el cálculo ni lo persistido).
 * Pasajero y conductor deben ver el mismo rango X … X+$3.000.
 */

import { roundTariffToHundred } from "@/lib/tariff/calculator";

/** Margen fijo solo para UI del rango estimado. */
export const ESTIMATED_FARE_RANGE_MARGIN_COP = 3000;

export function formatCopSymbol(amount: number): string {
  return `$${roundTariffToHundred(amount).toLocaleString("es-CO")}`;
}

/** Bloque de tarifa estimada para oferta al conductor (rango + aclaración). */
export function formatEstimatedFareRangeLine(calculatedAmount: number): string {
  const minLabel = formatCopSymbol(calculatedAmount);
  const maxLabel = formatCopSymbol(
    calculatedAmount + ESTIMATED_FARE_RANGE_MARGIN_COP,
  );
  return [
    `💰 Tarifa estimada: entre ${minLabel} y ${maxLabel}`,
    "⚠️ El valor final a cobrar será el que marque el taxímetro.",
  ].join("\n");
}

/** Bloque completo para resumen al pasajero. */
export function formatEstimatedFareRangePassenger(
  calculatedAmount: number,
): string {
  const minLabel = formatCopSymbol(calculatedAmount);
  const maxLabel = formatCopSymbol(
    calculatedAmount + ESTIMATED_FARE_RANGE_MARGIN_COP,
  );
  return [
    `💰 Tarifa estimada: ${minLabel} - ${maxLabel}`,
    "",
    "El valor final será el que marque el taxímetro, de acuerdo con la tarifa oficial vigente, más $800 por solicitud del servicio.",
  ].join("\n");
}
