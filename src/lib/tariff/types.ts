/**
 * Tariff Engine v1 — tipos públicos.
 * Mobility no calcula tarifas; solo consume estos contratos.
 */

export type TariffKind = "estimated" | "final";

export type GeoRef = {
  lat: number;
  lng: number;
  label?: string;
};

/** Parámetros tarifarios de una ciudad (sin lógica). */
export type CityTariffConfig = {
  citySlug: string;
  cityName: string;
  currency: "COP";
  /** Banderazo / bajada de bandera. */
  flagDrop: number;
  /** Carrera mínima oficial. */
  minimumFare: number;
  /** Metros incluidos en el banderazo. */
  minDistanceMeters: number;
  /** Cada N metros adicionales. */
  incrementMeters: number;
  /** Valor por cada incremento de distancia. */
  incrementAmount: number;
  /**
   * Cobro por tiempo de recorrido (0 = ciudad no cobra tiempo de marcha).
   * Unidad en segundos; amount por unidad completa.
   */
  timeUnitSeconds: number;
  timeAmount: number;
  /** Unidad de espera (segundos) y valor por unidad. */
  waitUnitSeconds: number;
  waitAmount: number;
  /**
   * Umbral de velocidad media (km/h) bajo el cual se estima espera.
   * Preparado para cálculo automático; taxímetro puede sobrescribir waitSeconds.
   */
  waitSpeedThresholdKmh: number;
  surcharges: {
    night: number;
    sundayHoliday: number;
    airport: number;
    /** Recargo de plataforma WhatXia. */
    platform: number;
  };
  nightStartHour: number;
  /**
   * Hora de fin exclusiva (0–23), leída de fare_rules.
   * Ventana [nightStartHour, nightEndHour) en horas locales;
   * si start > end, cruza medianoche.
   * Ej. fin 05:59:59 → nightEndHour = 6.
   */
  nightEndHour: number;
  holidayDates: string[];
  airport: {
    keywords: string[];
    centerLat: number | null;
    centerLng: number | null;
    radiusMeters: number | null;
  };
};

export type TariffBreakdown = {
  flagDrop: number;
  distanceValue: number;
  timeValue: number;
  waitValue: number;
  surchargeNight: number;
  surchargeSundayHoliday: number;
  surchargeAirport: number;
  surchargePlatform: number;
  officialRaw: number;
  officialFare: number;
  minimumApplied: boolean;
  total: number;
  /** Segundos de espera usados en el cálculo. */
  waitSecondsUsed: number;
  /** Cómo se obtuvo la espera. */
  waitSource: "provided" | "speed_heuristic" | "none";
};

export type TariffQuote = {
  kind: TariffKind;
  citySlug: string;
  amount: number;
  currency: "COP";
  distanceMeters: number;
  durationSeconds: number;
  distanceKm: number;
  durationMin: number;
  breakdown: TariffBreakdown;
  /** Origen del cálculo (local | futuro taxímetro / externo). */
  provider: string;
};

export type EstimateFareInput = {
  citySlug: string;
  origin: GeoRef;
  destination: GeoRef;
  distanceMeters: number;
  durationSeconds: number;
  /** Momento de cotización (default: ahora). */
  at?: Date;
  /**
   * Espera conocida (p. ej. taxímetro). Si se omite, en estimado = 0
   * (la heurística de velocidad solo aplica a tarifa final por defecto).
   */
  waitSeconds?: number;
};

export type FinalizeFareInput = {
  citySlug: string;
  origin?: GeoRef;
  destination?: GeoRef;
  /** Distancia real recorrida. */
  distanceMeters: number;
  /** Tiempo total del recorrido. */
  durationSeconds: number;
  startedAt: Date;
  finishedAt: Date;
  /**
   * Espera medida (taxímetro / telemetría).
   * Si se omite, el motor puede derivarla por velocidad media.
   */
  waitSeconds?: number;
  /** Si true (default), deriva espera cuando no viene waitSeconds. */
  deriveWaitFromSpeed?: boolean;
};

/** Contrato para motores futuros (taxímetro, API externa, dinámicas). */
export type TariffProvider = {
  readonly id: string;
  estimate(input: EstimateFareInput, config: CityTariffConfig): Promise<TariffQuote>;
  finalize(input: FinalizeFareInput, config: CityTariffConfig): Promise<TariffQuote>;
};
