import { NextRequest, NextResponse } from "next/server";
import { authenticateDriverAppBearer } from "@/lib/driver-auth-session";
import {
  handleDriverAppAccept,
  type DriverAppAcceptResult,
} from "@/lib/dispatch";

/**
 * Aceptar un servicio desde WhatXia Driver.
 * La asignación es la común; no se envía WhatsApp al conductor.
 */
function acceptHttpStatus(result: DriverAppAcceptResult): number {
  if (result.ok) {
    return 200;
  }

  switch (result.reason) {
    case "TRIP_NOT_FOUND":
      return 404;
    case "ALREADY_TAKEN":
      return 409;
    case "DRIVER_NOT_FOUND":
    case "DRIVER_NOT_AVAILABLE":
    case "DRIVER_NOT_ELIGIBLE":
      return 403;
    case "ETA_NOT_SAVED":
      return 500;
    default:
      return 500;
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const auth = await authenticateDriverAppBearer(
      request.headers.get("authorization"),
    );

    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
        { status: auth.status },
      );
    }

    const { tripId: rawTripId } = await context.params;
    const tripId = rawTripId?.trim() ?? "";
    if (!tripId) {
      return NextResponse.json(
        { ok: false, reason: "TRIP_NOT_FOUND" },
        { status: 404 },
      );
    }

    const result = await handleDriverAppAccept(auth.phone, tripId);
    return NextResponse.json(result, { status: acceptHttpStatus(result) });
  } catch (error) {
    console.error("[api/driver/services/accept]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
