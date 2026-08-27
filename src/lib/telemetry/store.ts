/**
 * Persistencia de telemetría OwnTracks.
 * No escribe trip_id ni toca booking/dispatch.
 */

import { getSupabase } from "@/lib/supabase/client";
import type { ParsedLocationPoint } from "@/lib/telemetry/owntracks";

export type TelemetryDeviceStatus = "active" | "revoked";

export type TelemetryDeviceRow = {
  id: string;
  driver_id: string;
  owntracks_user: string;
  owntracks_device: string;
  tid: string | null;
  status: TelemetryDeviceStatus;
  last_seen_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
};

export type IngestOwnTracksResult =
  | { status: "empty" }
  | { status: "missing_identity" }
  | { status: "not_enrolled" }
  | { status: "revoked" }
  | { status: "ok"; inserted: number; deviceId: string; driverId: string };

const DEVICE_COLUMNS =
  "id, driver_id, owntracks_user, owntracks_device, tid, status, last_seen_at, last_lat, last_lng";

function isDeviceStatus(value: unknown): value is TelemetryDeviceStatus {
  return value === "active" || value === "revoked";
}

function mapDevice(row: Record<string, unknown>): TelemetryDeviceRow {
  return {
    id: String(row.id),
    driver_id: String(row.driver_id),
    owntracks_user: String(row.owntracks_user),
    owntracks_device: String(row.owntracks_device),
    tid: typeof row.tid === "string" ? row.tid : null,
    status: isDeviceStatus(row.status) ? row.status : "revoked",
    last_seen_at: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
    last_lat: typeof row.last_lat === "number" ? row.last_lat : null,
    last_lng: typeof row.last_lng === "number" ? row.last_lng : null,
  };
}

export async function findTelemetryDevice(
  owntracksUser: string,
  owntracksDevice: string,
): Promise<TelemetryDeviceRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("driver_telemetry_devices")
    .select(DEVICE_COLUMNS)
    .eq("owntracks_user", owntracksUser)
    .eq("owntracks_device", owntracksDevice)
    .maybeSingle();

  if (error) {
    console.error("[telemetry] error al buscar dispositivo:", error);
    throw error;
  }

  return data ? mapDevice(data as Record<string, unknown>) : null;
}

function latestPoint(points: ParsedLocationPoint[]): ParsedLocationPoint {
  return points.reduce((latest, point) =>
    point.recordedAt.getTime() > latest.recordedAt.getTime() ? point : latest,
  );
}

async function persistDevicePoints(
  device: TelemetryDeviceRow,
  points: ParsedLocationPoint[],
): Promise<number> {
  const supabase = getSupabase();
  const receivedAt = new Date().toISOString();

  const rows = points.map((point) => ({
    device_id: device.id,
    driver_id: device.driver_id,
    trip_id: null,
    latitude: point.latitude,
    longitude: point.longitude,
    recorded_at: point.recordedAt.toISOString(),
    accuracy_m: point.accuracyM,
    velocity_kmh: point.velocityKmh,
    bearing_deg: point.bearingDeg,
    raw_payload: point.rawPayload,
    received_at: receivedAt,
  }));

  const { error: insertError } = await supabase
    .from("driver_location_points")
    .upsert(rows, {
      onConflict: "device_id,recorded_at",
      ignoreDuplicates: true,
    });

  if (insertError) {
    console.error("[telemetry] error al insertar puntos:", insertError);
    throw insertError;
  }

  const last = latestPoint(points);
  const { error: updateError } = await supabase
    .from("driver_telemetry_devices")
    .update({
      last_seen_at: receivedAt,
      last_lat: last.latitude,
      last_lng: last.longitude,
    })
    .eq("id", device.id);

  if (updateError) {
    console.error("[telemetry] error al actualizar last_seen:", updateError);
    throw updateError;
  }

  return rows.length;
}

/**
 * Inserta puntos de un único dispositivo enrolado.
 * trip_id se deja NULL a propósito (piloto).
 */
export async function ingestOwnTracksLocations(
  points: ParsedLocationPoint[],
): Promise<IngestOwnTracksResult> {
  if (points.length === 0) {
    return { status: "empty" };
  }

  const firstIdentity = points[0]?.identity;
  if (!firstIdentity) {
    return { status: "missing_identity" };
  }

  for (const point of points) {
    if (
      !point.identity ||
      point.identity.user !== firstIdentity.user ||
      point.identity.device !== firstIdentity.device
    ) {
      return { status: "missing_identity" };
    }
  }

  const device = await findTelemetryDevice(
    firstIdentity.user,
    firstIdentity.device,
  );

  if (!device) {
    return { status: "not_enrolled" };
  }

  if (device.status !== "active") {
    return { status: "revoked" };
  }

  const inserted = await persistDevicePoints(device, points);
  console.log("[telemetry/owntracks]", {
    deviceId: device.id,
    driverId: device.driver_id,
    inserted,
  });

  return {
    status: "ok",
    inserted,
    deviceId: device.id,
    driverId: device.driver_id,
  };
}
