/**
 * Gate de acceso a solicitud de servicio (USER-001).
 * Depende del status del pasajero, no del Feature Flag.
 */

import {
  accessDeniedMessage,
  canPassengerRequestService,
  isPreLaunchMode,
} from "@/lib/passenger-status";
import {
  findOrCreatePassenger,
  findPassengerByPhone,
  type PassengerRow,
} from "@/lib/supabase/passengers";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import { ensureIdentityOrPrompt } from "@/lib/preferred-name";
import { sendTextMessage } from "@/lib/whatsapp/client";

export async function assertPassengerCanRequestService(
  phone: string,
  whatsappName?: string,
): Promise<PassengerRow | null> {
  const passenger = await findOrCreatePassenger(phone, whatsappName);
  if (canPassengerRequestService(passenger.status)) {
    return passenger;
  }

  await sendTextMessage(phone, accessDeniedMessage(passenger.status, passenger.preferred_name));
  console.log("[passenger-access] solicitud bloqueada", {
    phone: passenger.phone,
    status: passenger.status,
  });
  return null;
}

/**
 * USER-001: entrada temprana para usuario nuevo en pre-lanzamiento.
 * Debe ejecutarse antes del funnel de servicios y terminar con return en el handler.
 *
 * @returns true si el handler debe hacer return inmediato.
 */
export async function handlePreLaunchNewUserIfNeeded(
  phone: string,
  whatsappName: string,
): Promise<boolean> {
  // HOTFIX: nunca crear Pionero / onboarding pasajero si ya es conductor.
  const existingDriver = await findDriverByPhone(phone);
  if (existingDriver) {
    console.log("[user-001:prelaunch] rama SKIP", {
      reason: "conductor_registrado",
      phone,
      driverId: existingDriver.id,
    });
    return false;
  }

  const preLaunch = isPreLaunchMode();
  const existing = await findPassengerByPhone(phone);

  console.log("[user-001:prelaunch] evaluación", {
    phone,
    preLaunch,
    preLaunchEnv: process.env.PRE_LAUNCH_MODE ?? "(unset)",
    hasPassenger: Boolean(existing),
    passengerStatus: existing?.status ?? null,
  });

  if (existing || !preLaunch) {
    console.log("[user-001:prelaunch] rama SKIP", {
      reason: existing
        ? "passenger_ya_existe"
        : "PRE_LAUNCH_MODE_inactivo",
    });
    return false;
  }

  console.log(
    "[user-001:prelaunch] rama NUEVO_USUARIO → onboarding pionero + return",
    { phone },
  );

  const passenger = await ensureIdentityOrPrompt(phone, whatsappName);
  if (!passenger) {
    console.log(
      "[user-001:prelaunch] identidad incompleta → prompt enviado; fin",
    );
    return true;
  }

  if (!canPassengerRequestService(passenger.status)) {
    await sendTextMessage(
      phone,
      accessDeniedMessage(passenger.status, passenger.preferred_name),
    );
    console.log("[user-001:prelaunch] pionero/bloqueado → mensaje acceso; fin", {
      status: passenger.status,
    });
    return true;
  }

  console.log(
    "[user-001:prelaunch] WARNING status permite servicios en prelaunch",
    { status: passenger.status },
  );
  return true;
}
