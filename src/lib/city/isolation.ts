/**
 * Aislamiento operacional por ciudad (puro, sin I/O).
 * Ibagué: trip.city_id === driver.city_id.
 * Corredor Pasto: trip.city_id es la ciudad de origen; la flota es Pasto
 * (ver driverServesOriginCity).
 */

import { driverServesOriginCity } from "@/lib/city/corridors";

export function operationalCitiesMatch(
  tripCityId: string | null | undefined,
  driverCityId: string | null | undefined,
): boolean {
  if (!tripCityId || !driverCityId) return false;
  return tripCityId === driverCityId;
}

export { driverServesOriginCity };

export function canAcceptTripInCity(
  tripCityId: string | null | undefined,
  driverCityId: string | null | undefined,
): boolean {
  return operationalCitiesMatch(tripCityId, driverCityId);
}

export function filterDriversByTripCity<T extends { city_id: string | null }>(
  drivers: T[],
  tripCityId: string | null | undefined,
): T[] {
  if (!tripCityId) return [];
  return drivers.filter((driver) => driver.city_id === tripCityId);
}

export function republishKeepsTripCity(
  originalCityId: string | null | undefined,
  currentCityId: string | null | undefined,
): boolean {
  return Boolean(originalCityId) && originalCityId === currentCityId;
}
