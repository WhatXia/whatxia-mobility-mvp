import type { FareQuote, RouteEstimate } from "@/lib/geo/types";
import { getActiveFareRules } from "@/lib/pricing/rules";
import {
  distanceIncrementUnits,
  isAirportTrip,
  isNightTime,
  isSundayOrHoliday,
  waitIncrementUnits,
} from "@/lib/pricing/surcharges";
import type { FareContext, FareRules } from "@/lib/pricing/types";

export type { FareRules, FareContext };

/**
 * Cálculo puro de tarifa WhatXia (Sprint 25).
 *
 * 1) Tarifa oficial = banderazo + dist + espera
 * 2) Si < carrera mínima → carrera mínima
 * 3) Recargos oficiales aplicables
 * 4) + recargo WhatXia
 */
export function calculateFareWithRules(
  route: RouteEstimate,
  rules: FareRules,
  context: FareContext = {},
): FareQuote {
  const at = context.at ?? new Date();
  const waitSeconds = context.waitSeconds ?? 0;

  const distUnits = distanceIncrementUnits(route.distanceMeters, rules);
  const waitUnits = waitIncrementUnits(waitSeconds, rules);

  const distanceComponent = distUnits * rules.incrementAmount;
  const waitComponent = waitUnits * rules.waitAmount;
  const officialRaw = rules.flagDrop + distanceComponent + waitComponent;

  const minimumApplied = officialRaw < rules.minimumFare;
  const officialFare = Math.max(rules.minimumFare, officialRaw);

  const applyNight = isNightTime(at, rules);
  const applySundayHoliday = isSundayOrHoliday(at, rules);
  const applyAirport = isAirportTrip(context, rules);

  const surchargeNight = applyNight ? rules.surchargeNight : 0;
  const surchargeSundayHoliday = applySundayHoliday
    ? rules.surchargeSundayHoliday
    : 0;
  const surchargeAirport = applyAirport ? rules.surchargeAirport : 0;
  const surchargeWhatxia = rules.surchargeWhatxia;

  const amount =
    officialFare +
    surchargeNight +
    surchargeSundayHoliday +
    surchargeAirport +
    surchargeWhatxia;

  const distanceKm = Math.round((route.distanceMeters / 1000) * 10) / 10;
  const durationMin = Math.max(1, Math.round(route.durationSeconds / 60));

  return {
    amount,
    currency: "COP",
    distanceKm,
    durationMin,
    breakdown: {
      flagDrop: rules.flagDrop,
      distanceComponent,
      waitComponent,
      officialRaw,
      officialFare,
      minimumApplied,
      surchargeNight,
      surchargeSundayHoliday,
      surchargeAirport,
      surchargeWhatxia,
      // compat logs legacy
      base: rules.flagDrop,
      timeComponent: waitComponent,
      raw: officialRaw,
    },
  };
}

/** Carga reglas activas desde fare_rules y cotiza. */
export async function calculateFare(
  route: RouteEstimate,
  context: FareContext = {},
): Promise<FareQuote> {
  const rules = await getActiveFareRules();
  return calculateFareWithRules(route, rules, context);
}

export function formatFareCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")} COP`;
}
