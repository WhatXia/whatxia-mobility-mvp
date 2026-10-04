import { NextRequest, NextResponse } from "next/server";
import { issueDriverAppSessionToken } from "@/lib/driver-auth-session";
import { findDriverByPhone } from "@/lib/supabase/drivers";

/**
 * Activación del dispositivo: cédula + teléfono contra public.drivers.
 * Si coinciden y el conductor está active, devuelve el token una sola vez.
 */
function normalizeDocumentId(raw: string): string {
  return raw.replace(/\D/g, "");
}

function readActivation(
  body: unknown,
): { documentId: string; phone: string } | null {
  if (body === null || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (typeof record.document_id !== "string" || typeof record.phone !== "string") {
    return null;
  }

  const documentId = normalizeDocumentId(record.document_id);
  const phone = record.phone.trim();
  if (!documentId || !phone) {
    return null;
  }

  return { documentId, phone };
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const activation = readActivation(body);
    if (!activation) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const driver = await findDriverByPhone(activation.phone);
    const registeredDocument = normalizeDocumentId(driver?.document_id ?? "");
    const matches =
      driver != null &&
      registeredDocument.length > 0 &&
      registeredDocument === activation.documentId;

    if (!matches || !driver) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (driver.status !== "active") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const token = await issueDriverAppSessionToken(driver.phone, driver.id);
    return NextResponse.json({ token });
  } catch (error) {
    console.error("[api/driver/session]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
