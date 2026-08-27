import { timingSafeEqual } from "crypto";

export type OwnTracksAuthSuccess = {
  ok: true;
  username: string | null;
  method: "basic" | "bearer";
};

export type OwnTracksAuthFailure = {
  ok: false;
  status: 401;
  error: "unauthorized";
};

export type OwnTracksAuthResult = OwnTracksAuthSuccess | OwnTracksAuthFailure;

export type OwnTracksAuthInput = {
  authorizationHeader: string | null;
  /** Override de prueba; por defecto OWNTRACKS_HTTP_SECRET. */
  secret?: string | null;
  /** Override de prueba; por defecto OWNTRACKS_HTTP_USER. */
  fleetUser?: string | null;
};

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function parseBasicAuthorization(
  header: string,
): { username: string; password: string } | null {
  const match = /^Basic\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(match[1].trim(), "base64").toString("utf8");
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function parseBearerToken(header: string): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Autenticación M2M OwnTracks.
 * Fail closed si falta OWNTRACKS_HTTP_SECRET.
 * Password Basic (o Bearer) debe coincidir con el secreto de flota.
 * Si OWNTRACKS_HTTP_USER está definido, el username Basic debe coincidir.
 */
export function authenticateOwnTracksRequest(
  input: OwnTracksAuthInput,
): OwnTracksAuthResult {
  const secret =
    (input.secret !== undefined ? input.secret : readEnv("OWNTRACKS_HTTP_SECRET"))
      ?.trim() ?? "";

  if (!secret) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const header = input.authorizationHeader?.trim() || "";
  if (!header) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const fleetUserRaw =
    input.fleetUser !== undefined
      ? input.fleetUser
      : readEnv("OWNTRACKS_HTTP_USER");
  const fleetUser = fleetUserRaw?.trim() || null;

  const basic = parseBasicAuthorization(header);
  if (basic) {
    if (!timingSafeStringEqual(basic.password, secret)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    if (fleetUser && basic.username.trim() !== fleetUser) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    return {
      ok: true,
      username: basic.username.trim() || null,
      method: "basic",
    };
  }

  const bearer = parseBearerToken(header);
  if (bearer && timingSafeStringEqual(bearer, secret)) {
    return { ok: true, username: null, method: "bearer" };
  }

  return { ok: false, status: 401, error: "unauthorized" };
}
