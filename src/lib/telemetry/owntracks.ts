/**
 * Parser del payload HTTP JSON de OwnTracks (_type: location).
 * No asocia viajes ni toca dispatch.
 */

export type OwnTracksIdentity = {
  user: string;
  device: string;
  tid: string | null;
};

export type OwnTracksFallbackIdentity = {
  user?: string | null;
  device?: string | null;
};

export type ParsedLocationPoint = {
  latitude: number;
  longitude: number;
  recordedAt: Date;
  accuracyM: number | null;
  velocityKmh: number | null;
  bearingDeg: number | null;
  identity: OwnTracksIdentity | null;
  rawPayload: Record<string, unknown>;
};

export type ParseOwnTracksResult = {
  locations: ParsedLocationPoint[];
  skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeIdentityPart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readOptionalMetric(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

function readBearing(value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null || parsed < 0 || parsed > 360) {
    return null;
  }
  return parsed;
}

function readTid(value: unknown): string | null {
  const tid = normalizeIdentityPart(value);
  return tid;
}

/**
 * OwnTracks topic típico: owntracks/<user>/<device>
 * También acepta user/device (sin prefijo).
 */
export function parseOwnTracksTopic(
  topic: unknown,
): { user: string; device: string } | null {
  const raw = normalizeIdentityPart(topic);
  if (!raw) {
    return null;
  }

  const parts = raw.split("/").filter((part) => part.length > 0);
  if (parts.length < 2) {
    return null;
  }

  if (parts[0].toLowerCase() === "owntracks") {
    if (parts.length < 3) {
      return null;
    }
    const user = parts[1];
    const device = parts[2];
    if (!user || !device) {
      return null;
    }
    return { user, device };
  }

  return { user: parts[0], device: parts[1] };
}

export function tstToDate(tst: unknown): Date | null {
  const value = readFiniteNumber(tst);
  if (value === null || value < 0) {
    return null;
  }

  const millis = value >= 1e12 ? value : value * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function isOwnTracksLocation(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._type === "location";
}

export function resolveOwnTracksIdentity(
  payload: Record<string, unknown>,
  fallback?: OwnTracksFallbackIdentity,
): OwnTracksIdentity | null {
  const fromTopic = parseOwnTracksTopic(payload.topic);
  const tid = readTid(payload.tid);
  const user =
    fromTopic?.user || normalizeIdentityPart(fallback?.user) || null;
  const device =
    fromTopic?.device ||
    normalizeIdentityPart(fallback?.device) ||
    tid ||
    null;

  if (!user || !device) {
    return null;
  }

  return { user, device, tid };
}

function parseLocationObject(
  payload: Record<string, unknown>,
  fallback?: OwnTracksFallbackIdentity,
): ParsedLocationPoint | null {
  const latitude = readFiniteNumber(payload.lat);
  const longitude = readFiniteNumber(payload.lon);
  if (latitude === null || latitude < -90 || latitude > 90) {
    return null;
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    return null;
  }

  const recordedAt = tstToDate(payload.tst) ?? new Date();

  return {
    latitude,
    longitude,
    recordedAt,
    accuracyM: readOptionalMetric(payload.acc),
    velocityKmh: readOptionalMetric(payload.vel),
    bearingDeg: readBearing(payload.cog),
    identity: resolveOwnTracksIdentity(payload, fallback),
    rawPayload: payload,
  };
}

/**
 * Acepta un objeto o un array. Solo procesa `_type: "location"`.
 */
export function parseOwnTracksPayload(
  body: unknown,
  fallback?: OwnTracksFallbackIdentity,
): ParseOwnTracksResult {
  const items = Array.isArray(body) ? body : [body];
  const locations: ParsedLocationPoint[] = [];
  let skipped = 0;

  for (const item of items) {
    if (!isOwnTracksLocation(item)) {
      skipped += 1;
      continue;
    }
    const parsed = parseLocationObject(item, fallback);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    locations.push(parsed);
  }

  return { locations, skipped };
}
