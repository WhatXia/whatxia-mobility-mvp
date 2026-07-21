function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export type PricingConfig = {
  baseFare: number;
  perKm: number;
  perMin: number;
  minimumFare: number;
};

export function getPricingConfig(): PricingConfig {
  return {
    baseFare: envNumber("PRICING_BASE_FARE", 3000),
    perKm: envNumber("PRICING_PER_KM", 1200),
    perMin: envNumber("PRICING_PER_MIN", 200),
    minimumFare: envNumber("PRICING_MINIMUM_FARE", 6000),
  };
}

export function roundToHundreds(value: number): number {
  return Math.round(value / 100) * 100;
}
