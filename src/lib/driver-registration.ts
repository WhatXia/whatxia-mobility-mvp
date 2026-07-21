import type { IncomingMessage, UserSession } from "@/types";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import { createDriver, findDriverByPhone } from "@/lib/supabase/drivers";
import { sendTextMessage } from "@/lib/whatsapp/client";

export async function startDriverRegistration(phone: string): Promise<void> {
  const existing = await findDriverByPhone(phone);

  if (existing) {
    clearSession(phone);
    await sendTextMessage(
      phone,
      "✅ Ya estás registrado y disponible para recibir servicios.",
    );
    return;
  }

  upsertSession(phone, {
    state: "WAITING_DRIVER_NAME",
    pickupNeighborhood: null,
    driverName: null,
  });

  await sendTextMessage(
    phone,
    "Bienvenido a WhatXia Mobility. Vamos a registrar tu vehículo.",
  );
  await sendTextMessage(phone, "Escribe tu nombre completo.");
}

export async function continueDriverRegistration(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!message.text) {
    return false;
  }

  if (session.state === "WAITING_DRIVER_NAME") {
    const driverName = message.text.trim();

    upsertSession(message.phone, {
      state: "WAITING_DRIVER_PLATE",
      driverName,
    });

    await sendTextMessage(message.phone, "Ahora escribe la placa del vehículo.");
    return true;
  }

  if (session.state === "WAITING_DRIVER_PLATE") {
    const plate = message.text.trim().toUpperCase();
    const driverName = session.driverName?.trim();

    if (!driverName) {
      upsertSession(message.phone, {
        state: "WAITING_DRIVER_NAME",
        driverName: null,
      });
      await sendTextMessage(message.phone, "Escribe tu nombre completo.");
      return true;
    }

    await createDriver({
      phone: message.phone,
      name: driverName,
      plate,
    });

    clearSession(message.phone);

    await sendTextMessage(
      message.phone,
      "✅ Registro completado. Ya puedes recibir servicios.",
    );
    return true;
  }

  return false;
}

export function isDriverRegistrationState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "WAITING_DRIVER_NAME" ||
    session?.state === "WAITING_DRIVER_PLATE"
  );
}

export function getActiveRegistrationSession(
  phone: string,
): UserSession | undefined {
  const session = getSession(phone);
  return isDriverRegistrationState(session) ? session : undefined;
}
