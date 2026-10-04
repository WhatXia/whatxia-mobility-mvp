/**
 * Persistencia de sesión autenticada de conductor.
 * Independiente de conversation_sessions y de is_available.
 *
 * WhatsApp sigue entrando por teléfono (`whatsapp_authenticated`).
 * La app whatxia-driver-v1 presenta un token aleatorio; en base solo
 * queda su SHA-256 (`token_hash`). El secreto en claro sale una vez,
 * en la activación, y no se vuelve a leer.
 */

import { createHash, randomBytes } from "crypto";
import { getSupabase } from "@/lib/supabase/client";
import {
  findDriverById,
  type DriverRow,
} from "@/lib/supabase/drivers";
import { normalizePhone } from "@/lib/trips";

const APP_TOKEN_BYTES = 32;

export type DriverAuthSession = {
  phone: string;
  driverId: string;
  createdAt: string;
};

export async function getDriverAuthSession(
  phone: string,
): Promise<DriverAuthSession | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("driver_auth_sessions")
    .select("phone, driver_id, created_at")
    .eq("phone", normalized)
    .eq("whatsapp_authenticated", true)
    .maybeSingle();

  if (error) {
    console.error("[driver-auth-session] error al leer:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    phone: data.phone as string,
    driverId: data.driver_id as string,
    createdAt: data.created_at as string,
  };
}

export async function createDriverAuthSession(
  phone: string,
  driverId: string,
): Promise<void> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  // No incluir token_hash: el upsert de WhatsApp no debe borrar el token de la app.
  const { error } = await supabase.from("driver_auth_sessions").upsert(
    {
      phone: normalized,
      driver_id: driverId,
      created_at: new Date().toISOString(),
      whatsapp_authenticated: true,
    },
    { onConflict: "phone" },
  );

  if (error) {
    console.error("[driver-auth-session] error al crear:", error);
    throw error;
  }

  console.log("[driver-auth-session:create]", {
    phone: normalized,
    driverId,
  });
}

export async function clearDriverAuthSession(phone: string): Promise<void> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { error } = await supabase
    .from("driver_auth_sessions")
    .delete()
    .eq("phone", normalized);

  if (error) {
    console.error("[driver-auth-session] error al eliminar:", error);
    throw error;
  }

  console.log("[driver-auth-session:clear]", { phone: normalized });
}

export async function getAuthenticatedDriver(
  phone: string,
): Promise<DriverRow | null> {
  const session = await getDriverAuthSession(phone);
  if (!session) {
    return null;
  }

  const driver = await findDriverById(session.driverId);
  if (!driver) {
    await clearDriverAuthSession(phone);
    return null;
  }

  return driver;
}

export type DriverAppAuthFailure = {
  ok: false;
  status: 401 | 403;
};

export type DriverAppAuthSuccess = {
  ok: true;
  driver: DriverRow;
};

export type DriverAppAuthResult = DriverAppAuthSuccess | DriverAppAuthFailure;

function hashDriverSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateDriverSessionToken(): string {
  return randomBytes(APP_TOKEN_BYTES).toString("base64url");
}

/**
 * Crea o rota el token de la app. Devuelve el secreto en claro una sola vez.
 * No enciende la sesión de WhatsApp si el conductor aún no inició sesión en el bot.
 */
export async function issueDriverAppSessionToken(
  phone: string,
  driverId: string,
): Promise<string> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);
  const token = generateDriverSessionToken();
  const tokenHash = hashDriverSessionToken(token);

  const { data: updated, error: updateError } = await supabase
    .from("driver_auth_sessions")
    .update({
      driver_id: driverId,
      token_hash: tokenHash,
    })
    .eq("phone", normalized)
    .select("phone")
    .maybeSingle();

  if (updateError) {
    console.error("[driver-app-session] error al rotar token:", updateError);
    throw updateError;
  }

  if (!updated) {
    const { error: insertError } = await supabase
      .from("driver_auth_sessions")
      .insert({
        phone: normalized,
        driver_id: driverId,
        token_hash: tokenHash,
        whatsapp_authenticated: false,
      });

    if (insertError) {
      const code =
        insertError && typeof insertError === "object" && "code" in insertError
          ? String((insertError as { code?: string }).code)
          : "";
      if (code === "23505") {
        const { data: retried, error: retryError } = await supabase
          .from("driver_auth_sessions")
          .update({
            driver_id: driverId,
            token_hash: tokenHash,
          })
          .eq("phone", normalized)
          .select("phone")
          .maybeSingle();
        if (retryError || !retried) {
          console.error("[driver-app-session] error al reintentar token:", retryError);
          throw retryError ?? new Error("No quedó sesión para el token de la app.");
        }
      } else {
        console.error("[driver-app-session] error al crear token:", insertError);
        throw insertError;
      }
    }
  }

  console.log("[driver-app-session:issue]", {
    phone: normalized,
    driverId,
  });

  return token;
}

async function getDriverAppSessionByToken(
  token: string,
): Promise<DriverAuthSession | null> {
  const supabase = getSupabase();
  const tokenHash = hashDriverSessionToken(token);

  const { data, error } = await supabase
    .from("driver_auth_sessions")
    .select("phone, driver_id, created_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    console.error("[driver-app-session] error al leer token:", error);
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    phone: data.phone as string,
    driverId: data.driver_id as string,
    createdAt: data.created_at as string,
  };
}

/**
 * Authorization: Bearer <token de activación>.
 * 401 si el token no corresponde a una sesión.
 * 403 si el conductor existe pero no está habilitado (status distinto de active).
 */
export async function authenticateDriverAppBearer(
  authorizationHeader: string | null,
): Promise<DriverAppAuthResult> {
  const header = authorizationHeader?.trim() ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const token = match?.[1] ?? "";
  if (!token) {
    return { ok: false, status: 401 };
  }

  const session = await getDriverAppSessionByToken(token);
  if (!session) {
    return { ok: false, status: 401 };
  }

  const driver = await findDriverById(session.driverId);
  if (!driver) {
    return { ok: false, status: 401 };
  }

  if (driver.status !== "active") {
    return { ok: false, status: 403 };
  }

  return { ok: true, driver };
}
