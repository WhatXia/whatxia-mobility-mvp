/**
 * Persistencia de sesión autenticada de conductor.
 * Independiente de conversation_sessions y de is_available.
 */

import { getSupabase } from "@/lib/supabase/client";
import {
  findDriverById,
  type DriverRow,
} from "@/lib/supabase/drivers";
import { normalizePhone } from "@/lib/trips";

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

  const { error } = await supabase.from("driver_auth_sessions").upsert(
    {
      phone: normalized,
      driver_id: driverId,
      created_at: new Date().toISOString(),
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
