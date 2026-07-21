import { NextRequest, NextResponse } from "next/server";
import { runDailyDocumentJobs } from "@/lib/document-jobs";

/**
 * Cron diario de gestión documental.
 * Proteger con CRON_SECRET (Vercel Cron envía Authorization: Bearer <CRON_SECRET>).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runDailyDocumentJobs();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/documents] error:", error);
    return NextResponse.json(
      { error: "Document job failed" },
      { status: 500 },
    );
  }
}
