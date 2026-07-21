import type { IncomingMessage, UserSession } from "@/types";
import {
  DRIVER_FIELDS,
  nextRegistrationStep,
  REGISTRATION_ORDER,
  validateDriverField,
  type DriverFieldKey,
} from "@/lib/driver-profile-fields";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  createDriver,
  draftToCreateInput,
  findDriverByPhone,
} from "@/lib/supabase/drivers";
import { sendTextMessage } from "@/lib/whatsapp/client";

function isFieldKey(value: string | null): value is DriverFieldKey {
  return Boolean(value && value in DRIVER_FIELDS);
}

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

  const firstStep = REGISTRATION_ORDER[0];

  upsertSession(phone, {
    state: "DRIVER_REGISTERING",
    pickupNeighborhood: null,
    driverName: null,
    driverDraft: {},
    driverFlowStep: firstStep,
    driverUpdateCategory: null,
    driverUpdateField: null,
  });

  await sendTextMessage(
    phone,
    "Bienvenido a WhatXia Mobility. Vamos a completar tu registro de conductor.",
  );
  await sendTextMessage(phone, DRIVER_FIELDS[firstStep].prompt);
}

export async function continueDriverRegistration(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!message.text || session.state !== "DRIVER_REGISTERING") {
    return false;
  }

  const step = session.driverFlowStep;
  if (!isFieldKey(step)) {
    clearSession(message.phone);
    await sendTextMessage(
      message.phone,
      "El registro se interrumpió. Escribe: Quiero ser conductor",
    );
    return true;
  }

  const parsed = validateDriverField(step, message.text);
  if (!parsed.ok) {
    await sendTextMessage(message.phone, parsed.error);
    await sendTextMessage(message.phone, DRIVER_FIELDS[step].prompt);
    return true;
  }

  const draft = {
    ...(session.driverDraft ?? {}),
    [step]: String(parsed.value),
  };

  const next = nextRegistrationStep(step);

  if (!next) {
    const input = draftToCreateInput(message.phone, draft);
    if (!input) {
      await sendTextMessage(
        message.phone,
        "Faltan datos del registro. Escribe: Quiero ser conductor",
      );
      clearSession(message.phone);
      return true;
    }

    await createDriver(input);
    clearSession(message.phone);

    await sendTextMessage(
      message.phone,
      "✅ Registro completado. Ya puedes recibir servicios.\n\nEscribe Hola para abrir tu menú de conductor.",
    );
    return true;
  }

  upsertSession(message.phone, {
    state: "DRIVER_REGISTERING",
    driverDraft: draft,
    driverFlowStep: next,
    driverName: draft.name ?? session.driverName,
  });

  await sendTextMessage(message.phone, `✅ ${DRIVER_FIELDS[step].label} guardado.`);
  await sendTextMessage(message.phone, DRIVER_FIELDS[next].prompt);
  return true;
}

export function isDriverRegistrationState(
  session: UserSession | undefined,
): boolean {
  return session?.state === "DRIVER_REGISTERING";
}

export function getActiveRegistrationSession(
  phone: string,
): UserSession | undefined {
  const session = getSession(phone);
  return isDriverRegistrationState(session) ? session : undefined;
}
