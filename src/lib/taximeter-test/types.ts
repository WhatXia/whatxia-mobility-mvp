/**
 * Taxímetro de prueba — tipos (capa calibración, no Mobility).
 */

export type TaximeterPickupType = "calle" | "satelital";

/** @deprecated alias de TaximeterPickupType */
export type TaximeterServiceType = TaximeterPickupType;

export type TaximeterSessionState =
  | "awaiting_start_location"
  | "measuring"
  | "awaiting_end_location"
  | "awaiting_meter_value"
  | "awaiting_service_type";

export type TaximeterRouteSnapshot = {
  provider: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  distanceMeters: number;
  durationSecondsWall: number;
  durationSecondsRoute: number | null;
  polylineEncoded: string | null;
  fallback: "haversine" | null;
};

export type TaximeterTestSession = {
  phone: string;
  driverId: string | null;
  driverName: string | null;
  state: TaximeterSessionState;
  startedAt: string | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  finishedAt: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  whatxiaFare: number | null;
  meterValue: number | null;
  routeProvider: string | null;
  routePolyline: string | null;
  route: TaximeterRouteSnapshot | null;
};

export type TaximeterTestRunInsert = {
  driverId: string | null;
  driverPhone: string;
  driverName: string | null;
  startedAt: string;
  finishedAt: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceMeters: number;
  durationSeconds: number;
  whatxiaFare: number;
  meterValue: number;
  differencePesos: number;
  differencePercent: number;
  pickupType: TaximeterPickupType;
  pickupSurcharge: number;
  routeProvider: string;
  pricingEngineVersion: string;
  routePolyline: string | null;
  route: TaximeterRouteSnapshot;
  citySlug: string | null;
};

/** Versión actual del motor WhatXia para etiquetar corridas de calibración. */
export const PRICING_ENGINE_VERSION = "v1";

export const ROUTE_PROVIDER_GOOGLE = "google_maps";
export const ROUTE_PROVIDER_HAVERSINE = "haversine";
