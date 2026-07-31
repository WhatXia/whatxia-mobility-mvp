/**
 * Certificación BOT-001 / CFG-001 — decisión PIONEER vs ACTIVE (sin I/O).
 * Ejecutar: npx tsx src/lib/launch-programs/decision.certify.ts
 */

import {
  computeAcceptsNewPioneers,
  statusForNewPassenger,
} from "./decision";

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

const now = Date.parse("2026-07-31T12:00:00.000Z");

// BOT-001: programa inactivo → nunca PIONEER
assert(
  !computeAcceptsNewPioneers({
    isActive: false,
    startsAt: null,
    endsAt: null,
    maxQuota: 200,
    registeredPioneers: 0,
    nowMs: now,
  }),
  "inactivo → no acepta",
);
assert(
  statusForNewPassenger(false) === "ACTIVE",
  "inactivo → status ACTIVE",
);

// Programa activo sin restricciones → PIONEER
assert(
  computeAcceptsNewPioneers({
    isActive: true,
    startsAt: null,
    endsAt: null,
    maxQuota: 200,
    registeredPioneers: 10,
    nowMs: now,
  }),
  "activo → acepta",
);
assert(
  statusForNewPassenger(true) === "PIONEER",
  "activo → status PIONEER",
);

// Cupo lleno → no acepta aunque is_active
assert(
  !computeAcceptsNewPioneers({
    isActive: true,
    startsAt: null,
    endsAt: null,
    maxQuota: 10,
    registeredPioneers: 10,
    nowMs: now,
  }),
  "cupo lleno → no acepta",
);

// Fuera de ventana ends_at → no acepta
assert(
  !computeAcceptsNewPioneers({
    isActive: true,
    startsAt: null,
    endsAt: "2026-07-01T00:00:00.000Z",
    maxQuota: null,
    registeredPioneers: 0,
    nowMs: now,
  }),
  "ends_at pasado → no acepta",
);

// BUG-PIONEERS-003: en el instante ends_at ya no acepta (now >= ends_at)
assert(
  !computeAcceptsNewPioneers({
    isActive: true,
    startsAt: null,
    endsAt: "2026-07-31T12:00:00.000Z",
    maxQuota: null,
    registeredPioneers: 0,
    nowMs: now,
  }),
  "now === ends_at → no acepta",
);

// starts_at futuro → no acepta
assert(
  !computeAcceptsNewPioneers({
    isActive: true,
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    maxQuota: null,
    registeredPioneers: 0,
    nowMs: now,
  }),
  "starts_at futuro → no acepta",
);

// Activo + inactivo explícito con fechas válidas: isActive manda
assert(
  !computeAcceptsNewPioneers({
    isActive: false,
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-12-31T00:00:00.000Z",
    maxQuota: 1000,
    registeredPioneers: 0,
    nowMs: now,
  }),
  "is_active=false gana aunque fechas/cupo OK (BOT-001)",
);

console.log("launch-programs/decision.certify: OK (BOT-001)");
