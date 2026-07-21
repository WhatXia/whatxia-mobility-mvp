import { NextRequest, NextResponse } from "next/server";
import { processDueSearchTimeouts } from "@/lib/search";

/**
 * Procesa timeouts de búsqueda (3 min / 2 min).
 * Autenticación: Authorization: Bearer CRON_SECRET
 * En Hobby invocar con un cron externo cada minuto si se desea precisión.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDueSearchTimeouts();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/search] error:", error);
    return NextResponse.json({ error: "Search job failed" }, { status: 500 });
  }
}
