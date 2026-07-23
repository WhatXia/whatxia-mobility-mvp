import type { FareContext, FareRules } from "@/lib/pricing/types";

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Ventana nocturna desde fare_rules (nightStartHour / nightEndHour).
 * Sin horas fijas en código. Fin exclusivo por hora.
 */
export function isNightTime(at: Date, rules: FareRules): boolean {
  const hour = at.getHours();
  const start = rules.nightStartHour;
  const end = rules.nightEndHour;

  if (start === end) {
    return false;
  }

  // Cruza medianoche cuando start > end (valores vienen de DB).
  if (start > end) {
    return hour >= start || hour < end;
  }

  return hour >= start && hour < end;
}

export function isSundayOrHoliday(at: Date, rules: FareRules): boolean {
  if (at.getDay() === 0) {
    return true;
  }

  const yyyy = at.getFullYear();
  const mm = String(at.getMonth() + 1).padStart(2, "0");
  const dd = String(at.getDate()).padStart(2, "0");
  const iso = `${yyyy}-${mm}-${dd}`;
  return rules.holidayDates.includes(iso);
}

function textMatchesAirport(text: string | undefined, keywords: string[]): boolean {
  if (!text || keywords.length === 0) {
    return false;
  }
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return keywords.some((kw) => {
    const needle = kw
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
    return needle.length > 0 && normalized.includes(needle);
  });
}

function pointNearAirport(
  lat: number | undefined,
  lng: number | undefined,
  rules: FareRules,
): boolean {
  if (
    lat === undefined ||
    lng === undefined ||
    rules.airportCenterLat == null ||
    rules.airportCenterLng == null ||
    rules.airportRadiusMeters == null
  ) {
    return false;
  }

  const d = haversineMeters(
    lat,
    lng,
    rules.airportCenterLat,
    rules.airportCenterLng,
  );
  return d <= rules.airportRadiusMeters;
}

export function isAirportTrip(context: FareContext, rules: FareRules): boolean {
  if (
    textMatchesAirport(context.pickupLabel, rules.airportKeywords) ||
    textMatchesAirport(context.dropoffLabel, rules.airportKeywords)
  ) {
    return true;
  }

  return (
    pointNearAirport(context.pickupLat, context.pickupLng, rules) ||
    pointNearAirport(context.dropoffLat, context.dropoffLng, rules)
  );
}

/** Unidades de incremento de distancia (parcial cuenta como 1). */
export function distanceIncrementUnits(
  distanceMeters: number,
  rules: FareRules,
): number {
  const extra = Math.max(0, distanceMeters - rules.minDistanceMeters);
  if (extra <= 0) {
    return 0;
  }
  return Math.ceil(extra / rules.incrementMeters);
}

export function waitIncrementUnits(
  waitSeconds: number,
  rules: FareRules,
): number {
  if (waitSeconds <= 0 || rules.waitSeconds <= 0) {
    return 0;
  }
  return Math.floor(waitSeconds / rules.waitSeconds);
}
