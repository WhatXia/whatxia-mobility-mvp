import { NextRequest, NextResponse } from "next/server";
import { runDailyDocumentJobs } from "@/lib/document-jobs";
import { closeExpiredTunnels } from "@/lib/tunnels";

/**
 * Cron diario de gestión documental (+ cierre de túneles vencidos).
 * Proteger con CRON_SECRET (Vercel Cron envía Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [docs, tunnelsClosed] = await Promise.all([
      runDailyDocumentJobs(),
      closeExpiredTunnels(),
    ]);

    return NextResponse.json({
      ok: true,
      documents: docs,
      tunnelsClosed,
    });
  } catch (error) {
    console.error("[cron/documents] error:", error);
    return NextResponse.json(
      { error: "Document job failed" },
      { status: 500 },
    );
  }
}
