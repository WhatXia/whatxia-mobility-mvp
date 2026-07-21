/**
 * Diagnóstico de esquema Supabase vs código Sprint 20/21 (solo lectura).
 * Ejecutar: npx tsx scripts/diagnose-dispatch-schema.mts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) {
    console.error("MISSING_ENV_FILE", envPath);
    process.exit(1);
  }
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("MISSING_ENV", {
    hasUrl: Boolean(url),
    hasServiceRoleKey: Boolean(key),
    cwd: process.cwd(),
  });
  process.exit(1);
}

const sb = createClient(url, key);

async function check() {
  console.log("=== DIAGNÓSTICO ESQUEMA / DESPACHO ===\n");

  const drivers = await sb
    .from("drivers")
    .select("id, phone, is_available, status, documents_blocked, suspended_until, cancel_policy_count")
    .eq("is_available", true)
    .eq("documents_blocked", false)
    .eq("status", "active");

  console.log("1) listAvailableDrivers-equivalent query:", {
    error: drivers.error
      ? {
          message: drivers.error.message,
          code: drivers.error.code,
          details: drivers.error.details,
          hint: drivers.error.hint,
        }
      : null,
    count: drivers.data?.length ?? 0,
    sample: (drivers.data ?? []).slice(0, 5).map((d) => ({
      id: d.id,
      phone: d.phone,
      suspended_until: d.suspended_until,
    })),
  });

  const passengersCols = await sb
    .from("passengers")
    .select("id, phone, no_show_count")
    .limit(1);
  console.log("\n2) passengers.no_show_count (migración 010):", {
    error: passengersCols.error
      ? {
          message: passengersCols.error.message,
          code: passengersCols.error.code,
        }
      : null,
    ok: !passengersCols.error,
  });

  const tripsCols = await sb
    .from("trips")
    .select(
      "id, status, search_deadline_at, continue_deadline_at, search_awaiting_continue",
    )
    .limit(1);
  console.log("\n3) trips search_* columns (migración 011):", {
    error: tripsCols.error
      ? {
          message: tripsCols.error.message,
          code: tripsCols.error.code,
        }
      : null,
    ok: !tripsCols.error,
  });

  const exclusions = await sb
    .from("trip_driver_exclusions")
    .select("trip_id, driver_id")
    .limit(1);
  console.log("\n4) trip_driver_exclusions (migración 012):", {
    error: exclusions.error
      ? {
          message: exclusions.error.message,
          code: exclusions.error.code,
        }
      : null,
    ok: !exclusions.error,
  });

  const recentSearching = await sb
    .from("trips")
    .select("id, status, passenger_phone, created_at, search_deadline_at")
    .eq("status", "SEARCHING")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("\n5) trips SEARCHING recientes:", {
    error: recentSearching.error?.message ?? null,
    rows: recentSearching.data ?? [],
  });

  console.log("\n=== INTERPRETACIÓN ===");
  if (drivers.error) {
    console.log(
      "ROTO en listAvailableDrivers (query drivers). Causa probable: migración 010 incompleta.",
    );
  } else if (passengersCols.error) {
    console.log(
      "ROTO en findOrCreatePassenger. Causa: falta no_show_count (migración 010). El pasajero ya vio 'Estamos buscando...' y createTrip/publish nunca corren.",
    );
  } else if (tripsCols.error) {
    console.log(
      "ROTO en createTrip. Causa: faltan columnas search_* (migración 011 / commit 72eb507). El pasajero ya vio 'Estamos buscando...' y publish nunca corre.",
    );
  } else if (exclusions.error) {
    console.log(
      "ROTO en publishTripOffer → listExcludedDriverIdsForTrip. Causa: falta tabla trip_driver_exclusions (migración 012 / commit 72eb507). El trip PUEDE haberse creado en SEARCHING pero WhatsApp no se envía.",
    );
  } else if ((drivers.data?.length ?? 0) === 0) {
    console.log(
      "ROTO por elegibilidad: 0 conductores available+active+not blocked. Debería enviarse 'Por ahora no hay conductores disponibles' (si no llegó, revisar logs).",
    );
  } else {
    console.log(
      "Esquema OK y hay conductores elegibles. Si el bug persiste, mirar logs [dispatch:diag] en el próximo request.",
    );
  }
}

check().catch((e) => {
  console.error(e);
  process.exit(1);
});
