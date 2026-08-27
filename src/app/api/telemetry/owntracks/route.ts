import { NextRequest, NextResponse } from "next/server";
import { authenticateOwnTracksRequest } from "@/lib/telemetry/auth";
import { parseOwnTracksPayload } from "@/lib/telemetry/owntracks";
import { ingestOwnTracksLocations } from "@/lib/telemetry/store";

/**
 * Ingest HTTP OwnTracks (POST application/json).
 * Independiente del webhook WhatsApp y del flujo de reservas.
 */
export async function POST(request: NextRequest) {
  const auth = authenticateOwnTracksRequest({
    authorizationHeader: request.headers.get("authorization"),
  });

  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fleetUser = process.env.OWNTRACKS_HTTP_USER?.trim() || null;
  const headerUser = request.headers.get("x-limit-u");
  const headerDevice = request.headers.get("x-limit-d");
  const basicUser =
    auth.method === "basic" && auth.username && auth.username !== fleetUser
      ? auth.username
      : null;

  const parsed = parseOwnTracksPayload(payload, {
    user: headerUser || basicUser,
    device: headerDevice,
  });

  if (parsed.locations.length === 0) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await ingestOwnTracksLocations(parsed.locations);

    if (result.status === "missing_identity") {
      return NextResponse.json(
        { error: "Missing OwnTracks user/device" },
        { status: 400 },
      );
    }

    if (result.status === "not_enrolled" || result.status === "revoked") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telemetry/owntracks] error:", error);
    return NextResponse.json(
      { error: "Telemetry ingest failed" },
      { status: 500 },
    );
  }
}
