import {
  getPricingConfig,
  roundToHundreds,
  type PricingConfig,
} from "@/lib/pricing/config";
import type { FareQuote, RouteEstimate } from "@/lib/geo/types";

/**
 * Motor de tarifas WhatXia (MVP).
 * fare = max(MINIMUM, round100(BASE + km*PER_KM + min*PER_MIN))
 */
export function calculateFare(
  route: RouteEstimate,
  config: PricingConfig = getPricingConfig(),
): FareQuote {
  const distanceKm = route.distanceMeters / 1000;
  const durationMin = route.durationSeconds / 60;

  const distanceComponent = distanceKm * config.perKm;
  const timeComponent = durationMin * config.perMin;
  const raw = config.baseFare + distanceComponent + timeComponent;
  const rounded = roundToHundreds(raw);
  const minimumApplied = rounded < config.minimumFare;
  const amount = Math.max(config.minimumFare, rounded);

  return {
    amount,
    currency: "COP",
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMin: Math.max(1, Math.round(durationMin)),
    breakdown: {
      base: config.baseFare,
      distanceComponent: Math.round(distanceComponent),
      timeComponent: Math.round(timeComponent),
      raw: Math.round(raw),
      minimumApplied,
    },
  };
}

export function formatFareCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")} COP`;
}
