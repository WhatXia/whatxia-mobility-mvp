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
import { EXPIRED_DOCS_MESSAGE } from "@/lib/driver-documents";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import { sendDriverMainMenu } from "@/lib/driver-menu";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export const DRIVER_REG_BUTTON_IDS = {
  CANCEL: "driver_reg_cancel",
  EXIT: "driver_reg_exit",
  CONTINUE: "driver_reg_continue",
  RESTART: "driver_reg_restart",
} as const;

const WELCOME_REGISTRATION = [
  "👋 Bienvenido a WhatXia Mobility.",
  "",
  "Vamos a completar tu registro como conductor.",
  "",
  "Antes de comenzar, ten presente lo siguiente:",
  "",
  "• Si seleccionas ❌ Cancelar inscripción, se eliminará el progreso de tu registro y, cuando vuelvas a iniciar, deberás comenzar desde cero.",
  "",
  "• Si seleccionas 🚪 Salir, guardaremos tu progreso y podrás continuar más adelante desde el punto donde quedaste enviando 🚖 o 🚕.",
].join("\n");

const REG_STEP_BUTTONS = [
  { id: DRIVER_REG_BUTTON_IDS.CANCEL, title: "Cancelar inscripción" },
  { id: DRIVER_REG_BUTTON_IDS.EXIT, title: "🚪 Salir" },
];

function isFieldKey(value: string | null | undefined): value is DriverFieldKey {
  return Boolean(value && value in DRIVER_FIELDS);
}

export type DriverRegButtonId =
  (typeof DRIVER_REG_BUTTON_IDS)[keyof typeof DRIVER_REG_BUTTON_IDS];

export function isDriverRegistrationButton(
  button: string | null | undefined,
): button is DriverRegButtonId {
  if (!button) {
    return false;
  }
  return (
    button === DRIVER_REG_BUTTON_IDS.CANCEL ||
    button === DRIVER_REG_BUTTON_IDS.EXIT ||
    button === DRIVER_REG_BUTTON_IDS.CONTINUE ||
    button === DRIVER_REG_BUTTON_IDS.RESTART
  );
}

async function sendRegistrationStepPrompt(
  phone: string,
  step: DriverFieldKey,
): Promise<void> {
  await sendButtonsMessage(phone, DRIVER_FIELDS[step].prompt, REG_STEP_BUTTONS);
}

function hasPendingRegistrationProgress(session: UserSession): boolean {
  if (
    session.state !== "DRIVER_REGISTRATION_PAUSED" &&
    session.state !== "DRIVER_REGISTRATION_RESUME_CHOICE" &&
    session.state !== "DRIVER_REGISTERING"
  ) {
    return false;
  }
  return Boolean(session.driverFlowStep);
}

async function offerResumeRegistration(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_REGISTRATION_RESUME_CHOICE",
  });
  await sendButtonsMessage(
    phone,
    "Tienes un registro de conductor pendiente. ¿Qué deseas hacer?",
    [
      { id: DRIVER_REG_BUTTON_IDS.CONTINUE, title: "▶️ Continuar" },
      { id: DRIVER_REG_BUTTON_IDS.RESTART, title: "🔄 Empezar de nuevo" },
    ],
  );
}

async function beginFreshRegistration(phone: string): Promise<void> {
  const firstStep = REGISTRATION_ORDER[0];

  await upsertSession(phone, {
    state: "DRIVER_REGISTERING",
    pickupNeighborhood: null,
    driverName: null,
    driverDraft: {},
    driverFlowStep: firstStep,
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendTextMessage(phone, WELCOME_REGISTRATION);
  await sendRegistrationStepPrompt(phone, firstStep);
}

export async function startDriverRegistration(phone: string): Promise<void> {
  const existing = await findDriverByPhone(phone);

  if (existing) {
    await clearSession(phone);
    await sendDriverMainMenu(existing, phone);
    return;
  }

  const session = await getSession(phone);

  // Registro pausado o progreso guardado → ofrecer continuar / empezar de nuevo
  if (
    session &&
    (session.state === "DRIVER_REGISTRATION_PAUSED" ||
      session.state === "DRIVER_REGISTRATION_RESUME_CHOICE" ||
      (session.state === "DRIVER_REGISTERING" &&
        hasPendingRegistrationProgress(session) &&
        Object.keys(session.driverDraft ?? {}).length > 0))
  ) {
    await offerResumeRegistration(phone);
    return;
  }

  await beginFreshRegistration(phone);
}

export async function handleDriverRegistrationButton(
  phone: string,
  button: string,
): Promise<boolean> {
  if (button === DRIVER_REG_BUTTON_IDS.CANCEL) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      "❌ Inscripción cancelada. Se eliminó todo el progreso.\n\nCuando quieras registrarte de nuevo, envía 🚖 o 🚕.",
    );
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.EXIT) {
    const session = await getSession(phone);
    if (!session || session.state !== "DRIVER_REGISTERING") {
      await sendTextMessage(
        phone,
        "No hay una inscripción en curso. Envía 🚖 o 🚕 para comenzar.",
      );
      return true;
    }

    await upsertSession(phone, {
      state: "DRIVER_REGISTRATION_PAUSED",
      driverDraft: session.driverDraft,
      driverFlowStep: session.driverFlowStep,
      driverName: session.driverName,
    });
    await sendTextMessage(
      phone,
      "🚪 Progreso guardado. Puedes continuar más adelante enviando 🚖 o 🚕.",
    );
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.CONTINUE) {
    const session = await getSession(phone);
    const step = session?.driverFlowStep;
    if (!session || !isFieldKey(step)) {
      await clearSession(phone);
      await beginFreshRegistration(phone);
      return true;
    }

    await upsertSession(phone, {
      state: "DRIVER_REGISTERING",
      driverDraft: session.driverDraft ?? {},
      driverFlowStep: step,
      driverName: session.driverName,
    });
    await sendTextMessage(phone, "Continuamos tu registro desde donde quedaste.");
    await sendRegistrationStepPrompt(phone, step);
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.RESTART) {
    await clearSession(phone);
    await beginFreshRegistration(phone);
    return true;
  }

  return false;
}

export async function continueDriverRegistration(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (session.state === "DRIVER_REGISTRATION_RESUME_CHOICE") {
    await offerResumeRegistration(message.phone);
    return true;
  }

  if (session.state !== "DRIVER_REGISTERING") {
    return false;
  }

  // Botones se manejan aparte; si llega texto vacío, reenviar paso.
  if (!message.text) {
    const step = session.driverFlowStep;
    if (isFieldKey(step)) {
      await sendRegistrationStepPrompt(message.phone, step);
    }
    return true;
  }

  const step = session.driverFlowStep;
  if (!isFieldKey(step)) {
    await clearSession(message.phone);
    await sendTextMessage(
      message.phone,
      "El registro se interrumpió. Envía 🚖 o 🚕 para reiniciar.",
    );
    return true;
  }

  const parsed = validateDriverField(step, message.text);
  if (!parsed.ok) {
    await sendTextMessage(message.phone, parsed.error);
    await sendRegistrationStepPrompt(message.phone, step);
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
        "Faltan datos del registro. Envía 🚖 o 🚕 para reiniciar.",
      );
      await clearSession(message.phone);
      return true;
    }

    const { documentsExpired } = await createDriver(input);
    await clearSession(message.phone);

    if (documentsExpired) {
      await sendExpiredDocumentsPrompt(message.phone, EXPIRED_DOCS_MESSAGE);
      return true;
    }

    await sendTextMessage(
      message.phone,
      [
        "✅ ¡Perfecto!",
        "",
        "Tu registro como conductor ha sido completado correctamente.",
        "",
        "Hemos recibido toda tu información. En adelante podrás acceder a tu módulo de conductor enviando 🚖 o 🚕.",
      ].join("\n"),
    );
    return true;
  }

  await upsertSession(message.phone, {
    state: "DRIVER_REGISTERING",
    driverDraft: draft,
    driverFlowStep: next,
    driverName: draft.name ?? session.driverName,
  });

  await sendRegistrationStepPrompt(message.phone, next);
  return true;
}

export function isDriverRegistrationState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_REGISTERING" ||
    session?.state === "DRIVER_REGISTRATION_RESUME_CHOICE"
  );
}

export function isDriverRegistrationPaused(
  session: UserSession | undefined,
): boolean {
  return session?.state === "DRIVER_REGISTRATION_PAUSED";
}

export async function getActiveRegistrationSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverRegistrationState(session) ? session : undefined;
}
