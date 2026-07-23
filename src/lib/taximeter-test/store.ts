/**
 * Persistencia del taxímetro de prueba (Supabase).
 * Independiente de conversation_sessions / trips.
 */

import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone } from "@/lib/trips";
import type {
  TaximeterRouteSnapshot,
  TaximeterTestRunInsert,
  TaximeterTestSession,
  TaximeterSessionState,
} from "@/lib/taximeter-test/types";

type SessionRow = {
  phone: string;
  driver_id: string | null;
  driver_name: string | null;
  state: string;
  started_at: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  finished_at: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  whatxia_fare: number | null;
  meter_value: number | null;
  route_provider: string | null;
  route_polyline: string | null;
  route: TaximeterRouteSnapshot | Record<string, unknown> | null;
};

function mapSession(row: SessionRow): TaximeterTestSession {
  const route =
    row.route && typeof row.route === "object" && "provider" in row.route
      ? (row.route as TaximeterRouteSnapshot)
      : null;

  return {
    phone: row.phone,
    driverId: row.driver_id,
    driverName: row.driver_name,
    state: row.state as TaximeterSessionState,
    startedAt: row.started_at,
    startLat: row.start_lat,
    startLng: row.start_lng,
    endLat: row.end_lat,
    endLng: row.end_lng,
    finishedAt: row.finished_at,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    whatxiaFare: row.whatxia_fare,
    meterValue: row.meter_value,
    routeProvider: row.route_provider,
    routePolyline: row.route_polyline,
    route,
  };
}

export async function getTaximeterSession(
  phone: string,
): Promise<TaximeterTestSession | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("taximeter_test_sessions")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[taximeter-test] error al leer sesión:", error);
    throw error;
  }

  return data ? mapSession(data as SessionRow) : null;
}

export async function upsertTaximeterSession(
  phone: string,
  patch: Partial<{
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
  }>,
): Promise<TaximeterTestSession> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const current = await getTaximeterSession(normalized);

  const row = {
    phone: normalized,
    driver_id: patch.driverId !== undefined ? patch.driverId : current?.driverId ?? null,
    driver_name:
      patch.driverName !== undefined ? patch.driverName : current?.driverName ?? null,
    state: patch.state ?? current?.state ?? "awaiting_start_location",
    started_at:
      patch.startedAt !== undefined ? patch.startedAt : current?.startedAt ?? null,
    start_lat:
      patch.startLat !== undefined ? patch.startLat : current?.startLat ?? null,
    start_lng:
      patch.startLng !== undefined ? patch.startLng : current?.startLng ?? null,
    end_lat: patch.endLat !== undefined ? patch.endLat : current?.endLat ?? null,
    end_lng: patch.endLng !== undefined ? patch.endLng : current?.endLng ?? null,
    finished_at:
      patch.finishedAt !== undefined ? patch.finishedAt : current?.finishedAt ?? null,
    distance_meters:
      patch.distanceMeters !== undefined
        ? patch.distanceMeters
        : current?.distanceMeters ?? null,
    duration_seconds:
      patch.durationSeconds !== undefined
        ? patch.durationSeconds
        : current?.durationSeconds ?? null,
    whatxia_fare:
      patch.whatxiaFare !== undefined
        ? patch.whatxiaFare
        : current?.whatxiaFare ?? null,
    meter_value:
      patch.meterValue !== undefined ? patch.meterValue : current?.meterValue ?? null,
    route_provider:
      patch.routeProvider !== undefined
        ? patch.routeProvider
        : current?.routeProvider ?? null,
    route_polyline:
      patch.routePolyline !== undefined
        ? patch.routePolyline
        : current?.routePolyline ?? null,
    route:
      patch.route !== undefined ? (patch.route ?? {}) : current?.route ?? {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("taximeter_test_sessions")
    .upsert(row, { onConflict: "phone" })
    .select("*")
    .single();

  if (error) {
    console.error("[taximeter-test] error al guardar sesión:", error);
    throw error;
  }

  return mapSession(data as SessionRow);
}

export async function clearTaximeterSession(phone: string): Promise<void> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { error } = await supabase
    .from("taximeter_test_sessions")
    .delete()
    .eq("phone", normalized);

  if (error) {
    console.error("[taximeter-test] error al cerrar sesión:", error);
    throw error;
  }
}

export async function insertTaximeterTestRun(
  run: TaximeterTestRunInsert,
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from("taximeter_test_runs").insert({
    driver_id: run.driverId,
    driver_phone: normalizePhone(run.driverPhone),
    driver_name: run.driverName,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    start_lat: run.startLat,
    start_lng: run.startLng,
    end_lat: run.endLat,
    end_lng: run.endLng,
    distance_meters: run.distanceMeters,
    duration_seconds: run.durationSeconds,
    whatxia_fare: run.whatxiaFare,
    meter_value: run.meterValue,
    difference_pesos: run.differencePesos,
    difference_percent: run.differencePercent,
    pickup_type: run.pickupType,
    pickup_surcharge: run.pickupSurcharge,
    route_provider: run.routeProvider,
    pricing_engine_version: run.pricingEngineVersion,
    route_polyline: run.routePolyline,
    route: run.route,
    city_slug: run.citySlug,
  });

  if (error) {
    console.error("[taximeter-test] error al insertar corrida:", error);
    throw error;
  }
}
