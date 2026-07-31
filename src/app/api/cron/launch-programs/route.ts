import { NextRequest, NextResponse } from "next/server";
import {
  drainLaunchOutboundQueueFully,
  processDueLaunchProgramClosures,
} from "@/lib/launch-programs/config";

/**
 * BUG-PIONEERS-003 — Cierra programas vencidos (ends_at) con la misma lógica
 * que el botón Desactivar (`closeLaunchProgram` → RPC deactivate_launch_program).
 * También drena la cola de mensajes de activación.
 *
 * Autenticación: Authorization: Bearer CRON_SECRET
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const due = await processDueLaunchProgramClosures();
    // Por si quedó cola de un cierre previo sin tráfico WhatsApp.
    const drained = await drainLaunchOutboundQueueFully();

    return NextResponse.json({
      ok: true,
      scanned: due.scanned,
      closed: due.closed,
      results: due.results,
      messagesDrained: drained,
    });
  } catch (error) {
    console.error("[cron/launch-programs] error:", error);
    return NextResponse.json(
      { error: "Launch programs job failed" },
      { status: 500 },
    );
  }
}
