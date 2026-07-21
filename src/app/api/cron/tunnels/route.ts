import { NextRequest, NextResponse } from "next/server";
import { closeExpiredTunnels } from "@/lib/tunnels";

/**
 * Cierra túneles cuyo closes_at ya venció (20 min tras finalizar viaje).
 * Autenticación: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const closed = await closeExpiredTunnels();
    return NextResponse.json({ ok: true, closed });
  } catch (error) {
    console.error("[cron/tunnels] error:", error);
    return NextResponse.json({ error: "Tunnel job failed" }, { status: 500 });
  }
}
