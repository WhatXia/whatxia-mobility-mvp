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
  draftToCreateInput,
  findDriverByDocumentId,
  findDriverByPhone,
} from "@/lib/supabase/drivers";
import {
  beginRegistrationPasswordSetup,
  routeAuthenticatedDriverEntry,
} from "@/lib/driver-auth";
import { catalogBody, cms } from "@/lib/bot-cms/copy";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export const DRIVER_REG_BUTTON_IDS = {
  START: "driver_reg_start",
  ABANDON: "driver_reg_abandon",
  CANCEL: "driver_reg_cancel",
  EXIT: "driver_reg_exit",
  CONTINUE: "driver_reg_continue",
  RESTART: "driver_reg_restart",
} as const;

const WELCOME_REGISTRATION = catalogBody("D_REG_WELCOME");

const WELCOME_BUTTONS = [
  { id: DRIVER_REG_BUTTON_IDS.START, title: "✅ Continuar" },
  { id: DRIVER_REG_BUTTON_IDS.ABANDON, title: "❌ Abandonar" },
];

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
    button === DRIVER_REG_BUTTON_IDS.START ||
    button === DRIVER_REG_BUTTON_IDS.ABANDON ||
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
    await cms("D_REG_RESUME"),
    [
      { id: DRIVER_REG_BUTTON_IDS.CONTINUE, title: "▶️ Continuar" },
      { id: DRIVER_REG_BUTTON_IDS.RESTART, title: "🔄 Empezar de nuevo" },
    ],
  );
}

async function offerWelcomeRegistration(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_REGISTRATION_WELCOME",
    pickupNeighborhood: null,
    driverName: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendButtonsMessage(phone, WELCOME_REGISTRATION, WELCOME_BUTTONS);
}

async function startRegistrationQuestions(phone: string): Promise<void> {
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

  await sendRegistrationStepPrompt(phone, firstStep);
}

export async function startDriverRegistration(phone: string): Promise<void> {
  const existing = await findDriverByPhone(phone);

  if (existing) {
    await routeAuthenticatedDriverEntry(phone, existing);
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

  await offerWelcomeRegistration(phone);
}

export async function handleDriverRegistrationButton(
  phone: string,
  button: string,
): Promise<boolean> {
  if (button === DRIVER_REG_BUTTON_IDS.START) {
    await startRegistrationQuestions(phone);
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.ABANDON) {
    await clearSession(phone);
    await sendTextMessage(phone, await cms("D_REG_ABANDONED"));
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.CANCEL) {
    await clearSession(phone);
    await sendTextMessage(phone, await cms("D_REG_CANCELLED"));
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.EXIT) {
    const session = await getSession(phone);
    if (!session || session.state !== "DRIVER_REGISTERING") {
      await sendTextMessage(phone, await cms("D_REG_NO_ACTIVE"));
      return true;
    }

    await upsertSession(phone, {
      state: "DRIVER_REGISTRATION_PAUSED",
      driverDraft: session.driverDraft,
      driverFlowStep: session.driverFlowStep,
      driverName: session.driverName,
    });
    await sendTextMessage(phone, await cms("D_REG_EXIT_SAVED"));
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.CONTINUE) {
    const session = await getSession(phone);
    const step = session?.driverFlowStep;
    if (!session || !isFieldKey(step)) {
      await clearSession(phone);
      await offerWelcomeRegistration(phone);
      return true;
    }

    await upsertSession(phone, {
      state: "DRIVER_REGISTERING",
      driverDraft: session.driverDraft ?? {},
      driverFlowStep: step,
      driverName: session.driverName,
    });
    await sendTextMessage(phone, await cms("D_REG_CONTINUE_OK"));
    await sendRegistrationStepPrompt(phone, step);
    return true;
  }

  if (button === DRIVER_REG_BUTTON_IDS.RESTART) {
    await clearSession(phone);
    await offerWelcomeRegistration(phone);
    return true;
  }

  return false;
}

export async function continueDriverRegistration(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (session.state === "DRIVER_REGISTRATION_WELCOME") {
    await offerWelcomeRegistration(message.phone);
    return true;
  }

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
    await sendTextMessage(message.phone, await cms("D_REG_INTERRUPTED"));
    return true;
  }

  const parsed = validateDriverField(step, message.text);
  if (!parsed.ok) {
    await sendTextMessage(message.phone, parsed.error);
    await sendRegistrationStepPrompt(message.phone, step);
    return true;
  }

  // Primer dato: cédula — bloquear si ya existe en drivers.document_id
  if (step === "document_id") {
    const existing = await findDriverByDocumentId(String(parsed.value));
    if (existing) {
      await clearSession(message.phone);
      await sendTextMessage(message.phone, await cms("D_REG_ALREADY_EXISTS"));
      return true;
    }
  }

  const draft = {
    ...(session.driverDraft ?? {}),
    [step]: String(parsed.value),
  };

  const next = nextRegistrationStep(step);

  if (!next) {
    const input = draftToCreateInput(message.phone, draft);
    if (!input) {
      await sendTextMessage(message.phone, await cms("D_REG_MISSING_DATA"));
      await clearSession(message.phone);
      return true;
    }

    // Fase 1 auth: pedir contraseña antes de crear el conductor.
    await beginRegistrationPasswordSetup(
      message.phone,
      draft,
      draft.name ?? session.driverName,
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
    session?.state === "DRIVER_REGISTRATION_WELCOME" ||
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
