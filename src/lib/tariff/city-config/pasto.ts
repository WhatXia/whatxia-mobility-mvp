import type { CityTariffConfig } from "@/lib/tariff/types";

/**
 * Seed / fixture placeholder — Pasto.
 * NO es fuente operativa. Para activar: insertar fila en fare_rules + cities.
 */
export const pastoTariff: CityTariffConfig = {
  citySlug: "pasto",
  cityName: "Pasto",
  currency: "COP",
  flagDrop: 0,
  minimumFare: 0,
  minDistanceMeters: 0,
  incrementMeters: 100,
  incrementAmount: 0,
  timeUnitSeconds: 60,
  timeAmount: 0,
  waitUnitSeconds: 60,
  waitAmount: 0,
  waitSpeedThresholdKmh: 5,
  surcharges: {
    night: 0,
    sundayHoliday: 0,
    airport: 0,
    platform: 0,
  },
  nightStartHour: 20,
  nightEndHour: 5,
  holidayDates: [],
  airport: {
    keywords: ["aeropuerto", "antonio narino"],
    centerLat: 1.3964,
    centerLng: -77.2915,
    radiusMeters: 2500,
  },
};
