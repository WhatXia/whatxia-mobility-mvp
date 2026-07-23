/**
 * @deprecated NO USAR EN RUNTIME.
 * Documento histórico / fixture opcional. La tarifa oficial vive en
 * `public.fare_rules` (migración 022). El Tariff Engine no importa este archivo.
 */
import type { CityTariffConfig } from "@/lib/tariff/types";

/** @deprecated Solo referencia; SSoT = fare_rules. */
export const ibagueTariff: CityTariffConfig = {
  citySlug: "ibague",
  cityName: "Ibagué",
  countryCode: "CO",
  currency: "COP",
  flagDrop: 4500,
  minimumFare: 6600,
  minDistanceMeters: 1600,
  incrementMeters: 80,
  incrementAmount: 105,
  timeUnitSeconds: 0,
  timeAmount: 0,
  waitUnitSeconds: 40,
  waitAmount: 90,
  waitSpeedThresholdKmh: 5,
  surcharges: {
    night: 1000,
    sundayHoliday: 850,
    airport: 6500,
    platform: 800,
  },
  nightStartHour: 19,
  nightEndHour: 6,
  holidayDates: [],
  airport: {
    keywords: ["aeropuerto", "perales"],
    centerLat: 4.4214,
    centerLng: -75.1333,
    radiusMeters: 2500,
  },
};
