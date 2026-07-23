import type { CityTariffConfig } from "@/lib/tariff/types";

/**
 * Seed / fixture placeholder — Medellín.
 * NO es fuente operativa. Para activar: insertar fila en fare_rules + cities.
 */
export const medellinTariff: CityTariffConfig = {
  citySlug: "medellin",
  cityName: "Medellín",
  countryCode: "CO",
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
    keywords: ["aeropuerto", "jose maria cordova", "jmc"],
    centerLat: 6.1645,
    centerLng: -75.4231,
    radiusMeters: 3000,
  },
};
