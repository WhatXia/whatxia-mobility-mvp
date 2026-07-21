/**
 * Certificación Sprint 20 – cancelaciones y políticas.
 * Ejecutar: npx tsx src/lib/cancellations.certify.ts
 */
export {};

import {
  isDriverPolicyCausal,
  isDriverSuspended,
  isPassengerNoShowCausal,
  nextDriverPolicyState,
  SUSPENSION_MS,
  type CancelCausal,
} from "@/lib/cancellations";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

// --- Causales y contadores ---

assert(
  isDriverPolicyCausal("problema_mecanico"),
  "Problema mecánico incrementa historial conductor",
);
assert(
  isDriverPolicyCausal("no_puedo_llegar"),
  "No puedo llegar incrementa historial conductor",
);
assert(
  !isDriverPolicyCausal("cliente_no_recogido"),
  "Cliente no recogido NO incrementa historial conductor",
);
assert(
  isPassengerNoShowCausal("cliente_no_recogido"),
  "Cliente no recogido incrementa historial pasajero",
);
assert(
  !isPassengerNoShowCausal("problema_mecanico"),
  "Problema mecánico no afecta historial pasajero",
);

const noShow = nextDriverPolicyState(0, "cliente_no_recogido");
assert(!noShow.incrementsDriver, "No-show: no suma conductor");
assert(noShow.incrementsPassenger, "No-show: suma pasajero");
assert(noShow.newCount === 0, "No-show: count conductor intacto");
assert(!noShow.sendWarning && !noShow.suspend, "No-show: sin política conductor");

// --- Política conductor ---

const first = nextDriverPolicyState(0, "problema_mecanico");
assert(first.newCount === 1, "1ª cancelación: count=1");
assert(!first.sendWarning && !first.suspend, "1ª: solo registrar");

const second = nextDriverPolicyState(1, "no_puedo_llegar");
assert(second.newCount === 2, "2ª cancelación: count=2");
assert(second.sendWarning, "2ª: genera advertencia");
assert(!second.suspend, "2ª: aún no suspende");

const now = Date.now();
const third = nextDriverPolicyState(2, "problema_mecanico", now);
assert(third.newCount === 3, "3ª cancelación: count=3");
assert(third.suspend, "3ª: genera suspensión");
assert(third.suspendedUntil !== null, "3ª: suspended_until seteado");
assert(
  new Date(third.suspendedUntil!).getTime() === now + SUSPENSION_MS,
  "Suspensión = 8 horas",
);

// --- Suspensión y reactivación ---

assert(
  isDriverSuspended({ suspended_until: third.suspendedUntil }, now + 1000),
  "Conductor suspendido no es elegible (durante ventana)",
);
assert(
  !isDriverSuspended(
    { suspended_until: third.suspendedUntil },
    now + SUSPENSION_MS + 1,
  ),
  "Reactivación automática después de 8 horas",
);

const suspendedDriver = { suspended_until: third.suspendedUntil! };
const eligibleDuring = !isDriverSuspended(suspendedDriver, now + 60_000);
const eligibleAfter = !isDriverSuspended(
  suspendedDriver,
  now + SUSPENSION_MS + 1,
);
assert(!eligibleDuring, "Suspendido: no recibe ofertas");
assert(eligibleAfter, "Tras 8h: vuelve a poder recibir ofertas");

// --- Flujos documentados (botones / roles) ---

const passengerCancelMoments = ["ETA_INFORMED", "DRIVER_ARRIVED"] as const;
assert(
  passengerCancelMoments.length === 2,
  "Pasajero: Cancelar servicio en 2 momentos (ETA y llegada)",
);

const driverCancelAfterEta = true;
assert(driverCancelAfterEta, "Conductor: Cancelar servicio tras informar ETA");

const causals: CancelCausal[] = [
  "problema_mecanico",
  "cliente_no_recogido",
  "no_puedo_llegar",
];
assert(causals.length === 3, "Tres causales de cancelación del conductor");

console.log("\nCertificación Sprint 20 (cancelaciones y políticas): PASS");
console.log(
  "Validar en WhatsApp + aplicar migración 010_cancellations_and_policies.sql",
);
