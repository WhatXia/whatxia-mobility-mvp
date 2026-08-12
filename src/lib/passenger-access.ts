/**
 * Gate de acceso a solicitud de servicio (USER-001 / BUG-001).
 * La resolución de identidad conocida (conductor registrado) tiene prioridad
 * sobre PRE_LAUNCH / onboarding Pionero.
 */

import {
  accessDeniedMessage,
  canPassengerRequestService,
  isPreLaunchMode,
} from "@/lib/passenger-status";
import {
  ensureActivePassengerFromKnownIdentity,
  findOrCreatePassenger,
  findPassengerByPhone,
  hasFullName,
  hasPreferredName,
  type PassengerRow,
} from "@/lib/supabase/passengers";
import {
  findDriverByPhone,
  type DriverRow,
} from "@/lib/supabase/drivers";
import { ensureIdentityOrPrompt } from "@/lib/preferred-name";
import { sendTextMessage } from "@/lib/whatsapp/client";

function driverIdentityFields(driver: DriverRow) {
  const fullName = driver.full_name?.trim() || driver.name?.trim() || null;
  const preferredName =
    driver.preferred_name?.trim() || driver.name?.trim() || fullName;
  return { fullName, preferredName };
}

/**
 * Resuelve el pasajero para una solicitud de servicio.
 * - Conductor registrado: identidad del driver → pasajero ACTIVE (sin ensureIdentityOrPrompt).
 * - Pasajero (nuevo o existente): no exige onboarding previo; el nombre se captura
 *   después de la ubicación en el flujo de booking. PIONEER con identidad completa
 *   sigue bloqueado; PIONEER sin identidad (alta mínima en lanzamiento) → ACTIVE.
 */
export async function resolvePassengerForServiceRequest(
  phone: string,
  whatsappName?: string,
): Promise<PassengerRow | null> {
  const driver = await findDriverByPhone(phone);
  if (driver) {
    const { fullName, preferredName } = driverIdentityFields(driver);
    const passenger = await ensureActivePassengerFromKnownIdentity(phone, {
      fullName,
      preferredName,
      whatsappName,
    });

    if (passenger.status === "BLOCKED") {
      await sendTextMessage(
        phone,
        await accessDeniedMessage(passenger.status, passenger.preferred_name),
      );
      console.log("[passenger-access] conductor/pasajero BLOCKED", {
        phone: passenger.phone,
      });
      return null;
    }

    console.log("[passenger-access] BUG-001 identidad conductor → servicio", {
      phone: passenger.phone,
      status: passenger.status,
      driverId: driver.id,
    });
    return passenger;
  }

  // Solicitud de servicio: no bloquear con ensureIdentityOrPrompt (nombre post-ubicación).
  const passenger = await findOrCreatePassenger(phone, whatsappName);

  if (passenger.status === "BLOCKED") {
    await sendTextMessage(
      phone,
      await accessDeniedMessage(passenger.status, passenger.preferred_name),
    );
    console.log("[passenger-access] solicitud bloqueada", {
      phone: passenger.phone,
      status: passenger.status,
    });
    return null;
  }

  if (!canPassengerRequestService(passenger.status)) {
    const incompleteIdentity =
      !hasFullName(passenger) && !hasPreferredName(passenger);
    if (incompleteIdentity) {
      // Alta mínima para pedir servicio sin onboarding Pionero.
      const activated = await ensureActivePassengerFromKnownIdentity(phone, {
        whatsappName,
      });
      console.log(
        "[passenger-access] servicio sin identidad previa → ACTIVE",
        { phone: activated.phone, status: activated.status },
      );
      return activated;
    }

    await sendTextMessage(
      phone,
      await accessDeniedMessage(passenger.status, passenger.preferred_name),
    );
    console.log("[passenger-access] solicitud bloqueada", {
      phone: passenger.phone,
      status: passenger.status,
    });
    return null;
  }

  return passenger;
}

export async function assertPassengerCanRequestService(
  phone: string,
  whatsappName?: string,
): Promise<PassengerRow | null> {
  // BUG-001: si es conductor registrado, no usar findOrCreatePassenger (PIONEER).
  const driver = await findDriverByPhone(phone);
  if (driver) {
    const { fullName, preferredName } = driverIdentityFields(driver);
    const passenger = await ensureActivePassengerFromKnownIdentity(phone, {
      fullName,
      preferredName,
      whatsappName,
    });
    if (passenger.status === "BLOCKED") {
      await sendTextMessage(
        phone,
        await accessDeniedMessage(passenger.status, passenger.preferred_name),
      );
      return null;
    }
    return passenger;
  }

  const passenger = await findOrCreatePassenger(phone, whatsappName);
  if (canPassengerRequestService(passenger.status)) {
    return passenger;
  }

  await sendTextMessage(
    phone,
    await accessDeniedMessage(passenger.status, passenger.preferred_name),
  );
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
  // Nunca crear Pionero / onboarding pasajero si ya es conductor.
  const existingDriver = await findDriverByPhone(phone);
  if (existingDriver) {
    console.log("[user-001:prelaunch] rama SKIP", {
      reason: "conductor_registrado",
      phone,
      driverId: existingDriver.id,
    });
    return false;
  }

  const preLaunch = await isPreLaunchMode();
  const existing = await findPassengerByPhone(phone);

  console.log("[bot-001:pioneers] evaluación", {
    phone,
    programAccepting: preLaunch,
    source: "launch_programs.PIONEERS_USERS",
    hasPassenger: Boolean(existing),
    passengerStatus: existing?.status ?? null,
    // PRE_LAUNCH_MODE ya no decide (BOT-001); solo diagnóstico.
    deprecatedEnvPreLaunch: process.env.PRE_LAUNCH_MODE ?? "(unset)",
  });

  if (existing || !preLaunch) {
    console.log("[bot-001:pioneers] rama SKIP", {
      reason: existing
        ? "passenger_ya_existe"
        : "programa_pioneros_inactivo",
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
      await accessDeniedMessage(passenger.status, passenger.preferred_name),
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
