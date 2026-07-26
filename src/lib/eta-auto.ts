/**
 * Fase 1.1 — Cálculo de ETA automático.
 * Umbral: segundos desde la creación del viaje hasta la aceptación.
 */

export type AutomaticEtaRange = {
  minMinutes: number;
  maxMinutes: number;
};

/**
 * ≤ 60 segundos → 5–7 minutos.
 * > 60 segundos → 7–10 minutos.
 */
export function computeAutomaticEtaRange(
  elapsedSeconds: number,
): AutomaticEtaRange {
  if (elapsedSeconds <= 60) {
    return { minMinutes: 5, maxMinutes: 7 };
  }
  return { minMinutes: 7, maxMinutes: 10 };
}
