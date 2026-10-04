import { NextRequest, NextResponse } from "next/server";
import { authenticateDriverAppBearer } from "@/lib/driver-auth-session";
import { listAvailableServicesForDriver } from "@/lib/driver-services";

/**
 * Servicios SEARCHING que este conductor puede recibir.
 * Authorization: Bearer <token entregado en POST /api/driver/session>.
 */
export async function GET(request: NextRequest) {
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

    if (!auth.driver.is_available) {
      return NextResponse.json({ services: [] });
    }

    const services = await listAvailableServicesForDriver(auth.driver);
    return NextResponse.json({ services });
  } catch (error) {
    console.error("[api/driver/services]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
