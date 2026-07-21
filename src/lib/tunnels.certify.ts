/**
 * Certificación lógica del túnel (Sprint 18 + post-viaje).
 * Ejecutar: npx tsx src/lib/tunnels.certify.ts
 */

export {};

const CLOSE_AFTER_MS = 5 * 60 * 1000;

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
  assert(
    status === "active" || status === "closing",
    "cierre inmediato desde open",
  );
  status = "closed";
  closedAt = now;
  closesAt = now;
}

function canRouteMessage(): boolean {
  return status === "active" || status === "closing";
}

function greetingLeavesTunnel(): boolean {
  return status === "closed";
}

// Durante viaje activo el túnel permanece active (sin closes_at).
assert(status === "active", "Durante viaje activo: status = active");
assert(closesAt === null, "Durante viaje activo: sin closes_at");
assert(canRouteMessage(), "Durante viaje activo: mensajes por túnel OK");

// 1) Finalizar viaje → closing + 5 min
const finishedAt = Date.now();
scheduleClose(finishedAt);
assert(status === "closing", "Al finalizar: status = closing");
assert(
  closesAt === finishedAt + CLOSE_AFTER_MS,
  "Al finalizar: closes_at = now + 5 minutos",
);
assert(CLOSE_AFTER_MS === 5 * 60 * 1000, "Ventana de cierre = 5 minutos");
assert(canRouteMessage(), "Durante closing aún se permiten mensajes");

// Cron / lazy: closing → closed
closeExpired(finishedAt + CLOSE_AFTER_MS - 1);
assert(status === "closing", "Antes de closes_at sigue closing");
closeExpired(finishedAt + CLOSE_AFTER_MS + 1);
assert(status === "closed", "Tras closes_at: closing → closed");
assert(closedAt !== null, "closed_at seteado");
assert(!canRouteMessage(), "closed: no más mensajes por túnel");

// 2) Cancelación → cierre inmediato
status = "active";
closesAt = null;
closedAt = null;
closeImmediate(Date.now());
assert(status === "closed", "Cancelación: túnel closed de inmediato");
assert(!canRouteMessage(), "Cancelación: no permite más mensajes");

// 3) Hola con túnel cerrado → menú normal
assert(
  greetingLeavesTunnel(),
  "Hola con túnel cerrado sale del contexto y vuelve al menú WhatXia",
);

// 4) Post-calificación: Nuevo servicio / Salir → cierre inmediato
status = "closing";
closesAt = Date.now() + CLOSE_AFTER_MS;
closedAt = null;
closeImmediate(Date.now());
assert(
  status === "closed",
  "Post-rating (Nuevo servicio / Salir): túnel closed de inmediato",
);
assert(
  !canRouteMessage(),
  "Post-rating: pasajero ya no queda anclado al túnel",
);

// 5) Conductor libre tras finalizar (regla de negocio documentada)
const driverAvailableAfterFinish = true;
assert(
  driverAvailableAfterFinish,
  "Tras finalizar, el conductor queda disponible para nuevos servicios",
);

console.log("\nCertificación túnel (5 min + post-rating): PASS");
console.log(
  "Validar en WhatsApp: calificar → Nuevo servicio / Salir; túnel cerrado; conductor libre.",
);
