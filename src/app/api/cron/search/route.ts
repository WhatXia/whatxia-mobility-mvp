import { NextRequest, NextResponse } from "next/server";

/**
 * Procesa timeouts del WaitingFlow (2+2+2 min).
 * Autenticación: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { processDueWaitingFlow } = await import("@/lib/waiting-flow");
    const result = await processDueWaitingFlow();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/search] error:", error);
    return NextResponse.json({ error: "Search job failed" }, { status: 500 });
  }
}
