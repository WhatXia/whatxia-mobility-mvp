/**
 * Cálculo puro de promedios de calificación.
 * Reutilizable para conductores, pasajeros y futuras métricas.
 */

export type RatingAggregate = {
  /** Promedio a 1 decimal; null si no hay calificaciones. */
  average: number | null;
  count: number;
  // —— Extensión futura (no calculada en este flujo) ——
  distribution: null;
  last30DaysAverage: null;
};

export function emptyRatingAggregate(): RatingAggregate {
  return {
    average: null,
    count: 0,
    distribution: null,
    last30DaysAverage: null,
  };
}

/** Promedio con un decimal (p. ej. 4.8). */
export function computeAverage(ratings: number[]): RatingAggregate {
  const valid = ratings.filter(
    (r): r is number => typeof r === "number" && Number.isFinite(r),
  );

  if (valid.length === 0) {
    return emptyRatingAggregate();
  }

  const sum = valid.reduce((acc, n) => acc + n, 0);
  const average = Math.round((sum / valid.length) * 10) / 10;

  return {
    average,
    count: valid.length,
    distribution: null,
    last30DaysAverage: null,
  };
}

/** Formato canónico: "4.8 / 5.0" */
export function formatAverageScore(average: number): string {
  return `${average.toFixed(1)} / 5.0`;
}
