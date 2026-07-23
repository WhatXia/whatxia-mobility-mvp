import type {
  CityTariffConfig,
  GeoRef,
  TariffBreakdown,
  TariffKind,
  TariffQuote,
} from "@/lib/tariff/types";

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
 * ¿Aplica recargo nocturno según la ventana de la ciudad (fare_rules)?
 * Usa solo config.nightStartHour / nightEndHour — sin horas fijas en código.
 * Fin exclusivo por hora: incluye minutos de (end-1), excluye desde end:00.
 */
export function isNightTime(at: Date, config: CityTariffConfig): boolean {
  const hour = at.getHours();
  const start = config.nightStartHour;
  const end = config.nightEndHour;
  if (start === end) return false;
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

/**
 * ¿Aplica recargo domingo/festivo?
 * Domingo O festivo (flag desde public.holidays) → una sola vez.
 * No lee fare_rules.holiday_dates.
 */
export function appliesSundayHolidaySurcharge(
  at: Date,
  isPublicHoliday: boolean,
): boolean {
  return at.getDay() === 0 || isPublicHoliday;
}

/** @deprecated Usar appliesSundayHolidaySurcharge + isPublicHoliday(Supabase). */
export function isSundayOrHoliday(
  at: Date,
  _config: CityTariffConfig,
  isPublicHoliday = false,
): boolean {
  return appliesSundayHolidaySurcharge(at, isPublicHoliday);
}

function textMatchesAirport(
  text: string | undefined,
  keywords: string[],
): boolean {
  if (!text || keywords.length === 0) return false;
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
  point: GeoRef | undefined,
  config: CityTariffConfig,
): boolean {
  const { centerLat, centerLng, radiusMeters } = config.airport;
  if (
    !point ||
    centerLat == null ||
    centerLng == null ||
    radiusMeters == null
  ) {
    return false;
  }
  return (
    haversineMeters(point.lat, point.lng, centerLat, centerLng) <= radiusMeters
  );
}

export function isAirportTrip(
  origin: GeoRef | undefined,
  destination: GeoRef | undefined,
  config: CityTariffConfig,
): boolean {
  if (
    textMatchesAirport(origin?.label, config.airport.keywords) ||
    textMatchesAirport(destination?.label, config.airport.keywords)
  ) {
    return true;
  }
  return (
    pointNearAirport(origin, config) || pointNearAirport(destination, config)
  );
}

/** Unidades de distancia (parcial redondea hacia arriba). */
export function distanceIncrementUnits(
  distanceMeters: number,
  config: CityTariffConfig,
): number {
  const extra = Math.max(0, distanceMeters - config.minDistanceMeters);
  if (extra <= 0 || config.incrementMeters <= 0) return 0;
  return Math.ceil(extra / config.incrementMeters);
}

export function timeIncrementUnits(
  durationSeconds: number,
  config: CityTariffConfig,
): number {
  if (durationSeconds <= 0 || config.timeUnitSeconds <= 0) return 0;
  return Math.floor(durationSeconds / config.timeUnitSeconds);
}

export function waitIncrementUnits(
  waitSeconds: number,
  config: CityTariffConfig,
): number {
  if (waitSeconds <= 0 || config.waitUnitSeconds <= 0) return 0;
  return Math.floor(waitSeconds / config.waitUnitSeconds);
}

export type CalculateTariffParams = {
  kind: TariffKind;
  config: CityTariffConfig;
  distanceMeters: number;
  durationSeconds: number;
  waitSeconds: number;
  waitSource: TariffBreakdown["waitSource"];
  at: Date;
  /** Festivo según public.holidays (resuelto fuera del calculator). */
  isPublicHoliday: boolean;
  origin?: GeoRef;
  destination?: GeoRef;
  provider: string;
};

/**
 * Cálculo puro de tarifa (sin I/O).
 *
 * 1) Oficial = banderazo + distancia + tiempo marcha + espera
 * 2) Carrera mínima
 * 3) Recargos de ciudad + plataforma
 */
export function calculateTariff(params: CalculateTariffParams): TariffQuote {
  const { config, distanceMeters, durationSeconds, waitSeconds, at } = params;

  const distUnits = distanceIncrementUnits(distanceMeters, config);
  const timeUnits = timeIncrementUnits(durationSeconds, config);
  const waitUnits = waitIncrementUnits(waitSeconds, config);

  const distanceValue = distUnits * config.incrementAmount;
  const timeValue = timeUnits * config.timeAmount;
  const waitValue = waitUnits * config.waitAmount;

  const officialRaw =
    config.flagDrop + distanceValue + timeValue + waitValue;
  const minimumApplied = officialRaw < config.minimumFare;
  const officialFare = Math.max(config.minimumFare, officialRaw);

  const surchargeNight = isNightTime(at, config) ? config.surcharges.night : 0;
  const surchargeSundayHoliday = appliesSundayHolidaySurcharge(
    at,
    params.isPublicHoliday,
  )
    ? config.surcharges.sundayHoliday
    : 0;
  const surchargeAirport = isAirportTrip(
    params.origin,
    params.destination,
    config,
  )
    ? config.surcharges.airport
    : 0;
  const surchargePlatform = config.surcharges.platform;

  const total =
    officialFare +
    surchargeNight +
    surchargeSundayHoliday +
    surchargeAirport +
    surchargePlatform;

  const breakdown: TariffBreakdown = {
    flagDrop: config.flagDrop,
    distanceValue,
    timeValue,
    waitValue,
    surchargeNight,
    surchargeSundayHoliday,
    surchargeAirport,
    surchargePlatform,
    officialRaw,
    officialFare,
    minimumApplied,
    total,
    waitSecondsUsed: waitSeconds,
    waitSource: params.waitSource,
  };

  return {
    kind: params.kind,
    citySlug: config.citySlug,
    amount: total,
    currency: config.currency,
    distanceMeters,
    durationSeconds,
    distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
    durationMin: Math.max(1, Math.round(durationSeconds / 60)),
    breakdown,
    provider: params.provider,
  };
}

export function formatTariffCop(amount: number): string {
  return `$${amount.toLocaleString("es-CO")} COP`;
}
