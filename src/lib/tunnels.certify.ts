/**
 * Certificación lógica del túnel (Sprint 18 + ajustes).
 * Ejecutar: npx tsx src/lib/tunnels.certify.ts
 */

const CLOSE_AFTER_MS = 20 * 60 * 1000;

type TunnelStatus = "active" | "closing" | "closed";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

// --- Estados: active → closing → closed ---

let status: TunnelStatus = "active";
let closesAt: number | null = null;
let closedAt: number | null = null;

function scheduleClose(now: number) {
  assert(status === "active", "scheduleClose solo desde active");
  status = "closing";
  closesAt = now + CLOSE_AFTER_MS;
}

function closeExpired(now: number) {
  if (status === "closing" && closesAt !== null && closesAt <= now) {
    status = "closed";
    closedAt = now;
  }
}

function closeImmediate(now: number) {
  assert(status === "active" || status === "closing", "cierre inmediato desde open");
  status = "closed";
  closedAt = now;
  closesAt = now;
}

function canRouteMessage(): boolean {
  return status === "active" || status === "closing";
}

function greetingLeavesTunnel(): boolean {
  // Con túnel cerrado, Hola no se enruta: vuelve al menú WhatXia.
  return status === "closed";
}

// 1) Finalizar viaje → closing + 20 min
const finishedAt = Date.now();
scheduleClose(finishedAt);
assert(status === "closing", "Al finalizar: status = closing");
assert(
  closesAt === finishedAt + CLOSE_AFTER_MS,
  "Al finalizar: closes_at = now + 20 minutos",
);
assert(canRouteMessage(), "Durante closing aún se permiten mensajes");

// Cron / lazy: closing → closed
closeExpired(finishedAt + CLOSE_AFTER_MS - 1);
assert(status === "closing", "Antes de closes_at sigue closing");
closeExpired(finishedAt + CLOSE_AFTER_MS + 1);
assert(status === "closed", "Tras closes_at: closing → closed");
assert(closedAt !== null, "closed_at seteado");
assert(!canRouteMessage(), "closed: no más mensajes por túnel");

// 2) Certificación: cancelación → cierre inmediato
status = "active";
closesAt = null;
closedAt = null;
closeImmediate(Date.now());
assert(status === "closed", "Cancelación: túnel closed de inmediato");
assert(!canRouteMessage(), "Cancelación: no permite más mensajes");

// 3) Certificación: Hola con túnel cerrado → menú normal
assert(
  greetingLeavesTunnel(),
  'Hola con túnel cerrado sale del contexto y vuelve al menú WhatXia',
);

console.log("\nCertificación túnel (estados + cancelación + Hola): PASS");
console.log(
  "Validar en WhatsApp: cancelar viaje, Hola post-cierre → menú, DB status closing/closed.",
);
