import type { FareQuote } from "@/lib/geo/types";
import type { TariffQuote } from "@/lib/tariff/types";

/**
 * Adapta TariffQuote → FareQuote (forma legacy que usa booking/dispatch).
 * Mobility sigue mostrando el mismo shape; el cálculo ya no vive en pricing.
 */
export function tariffQuoteToFareQuote(quote: TariffQuote): FareQuote {
  const b = quote.breakdown;
  return {
    amount: quote.amount,
    currency: "COP",
    distanceKm: quote.distanceKm,
    durationMin: quote.durationMin,
    breakdown: {
      flagDrop: b.flagDrop,
      distanceComponent: b.distanceValue,
      waitComponent: b.waitValue,
      officialRaw: b.officialRaw,
      officialFare: b.officialFare,
      minimumApplied: b.minimumApplied,
      surchargeNight: b.surchargeNight,
      surchargeSundayHoliday: b.surchargeSundayHoliday,
      surchargeAirport: b.surchargeAirport,
      surchargeWhatxia: b.surchargePlatform,
      base: b.flagDrop,
      timeComponent: b.waitValue,
      raw: b.officialRaw,
    },
  };
}
