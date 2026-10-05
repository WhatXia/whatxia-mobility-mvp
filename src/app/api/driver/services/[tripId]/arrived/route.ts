import { NextRequest, NextResponse } from "next/server";
import { authenticateDriverAppBearer } from "@/lib/driver-auth-session";
import { handleDriverAppArrived } from "@/lib/dispatch";

/**
 * El conductor llegó al punto de recogida.
 * Reutiliza markDriverArrived y el aviso existente al pasajero.
 */
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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await handleDriverAppArrived(auth.driverId, tripId);
    if (!result.ok) {
      const error =
        result.httpStatus === 404
          ? "Not found"
          : result.httpStatus === 403
            ? "Forbidden"
            : "Conflict";
      return NextResponse.json({ error }, { status: result.httpStatus });
    }

    return NextResponse.json({
      ok: true,
      trip_id: result.trip_id,
      status: result.status,
    });
  } catch (error) {
    console.error("[api/driver/services/arrived]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
