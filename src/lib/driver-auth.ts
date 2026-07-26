/**
 * Autenticación de conductores:
 * - Fase 1: crear / confirmar contraseña.
 * - Fase 2: iniciar / cerrar sesión (separada de is_available).
 */

import type { IncomingMessage, UserSession } from "@/types";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  createDriver,
  draftToCreateInput,
  findDriverByPhone,
  setDriverAvailability,
  updateDriverPasswordHash,
  type DriverRow,
} from "@/lib/supabase/drivers";

import {
  createDriverAuthSession,
  clearDriverAuthSession,
  getAuthenticatedDriver,
} from "@/lib/driver-auth-session";
import { EXPIRED_DOCS_MESSAGE } from "@/lib/driver-documents";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import { DRIVER_MENU_IDS, sendDriverMainMenu } from "@/lib/driver-menu";
import {
  hashPassword,
  validatePasswordPlain,
  verifyPassword,
} from "@/lib/driver-password";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

import type { DriverDraft } from "@/lib/driver-profile-fields";

export const DRIVER_AUTH_BUTTON_IDS = {
  LOGIN: "driver_auth_login",
  FORGOT_PASSWORD: "driver_auth_forgot_password",
  LOGOUT: DRIVER_MENU_IDS.LOGOUT,
} as const;

/** Alias del botón pasajero / sesión cerrada. */
export const DRIVER_CLOSED_SOLICITAR_ID = "solicitar_servicio";

const PENDING_PASSWORD_KEY = "__password_pending";

type DraftWithPending = DriverDraft & {
  [PENDING_PASSWORD_KEY]?: string;
};

function getPendingPassword(draft: DriverDraft | null | undefined): string | null {
  const value = (draft as DraftWithPending | null | undefined)?.[
    PENDING_PASSWORD_KEY
  ];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function withPendingPassword(
  draft: DriverDraft | null | undefined,
  password: string,
): DraftWithPending {
  return {
    ...(draft ?? {}),
    [PENDING_PASSWORD_KEY]: password,
  };
}

function stripPendingPassword(
  draft: DriverDraft | null | undefined,
): DriverDraft {
  if (!draft) {
    return {};
  }
  const copy = { ...(draft as DraftWithPending) };
  delete copy[PENDING_PASSWORD_KEY];
  return copy;
}

function credentialsMessage(documentId: string, password: string): string {
  return [
    "✅ Contraseña configurada correctamente.",
    "",
    "Estos serán tus datos de acceso a WhatXia:",
    "",
    `Usuario: ${documentId}`,
    `Contraseña: ${password}`,
    "",
    "Guárdalos en un lugar seguro. Por seguridad, no volveremos a mostrar tu contraseña.",
  ].join("\n");
}

/** Sesión cerrada: solo Iniciar sesión + Solicitar servicio. */
export async function sendDriverClosedSessionMenu(phone: string): Promise<void> {
  await sendButtonsMessage(
    phone,
    [
      "👋 WhatXia Mobility — Conductores",
      "",
      "Tu sesión está cerrada. ¿Qué deseas hacer?",
    ].join("\n"),
    [
      {
        id: DRIVER_AUTH_BUTTON_IDS.LOGIN,
        title: "🔐 Iniciar sesión",
      },
      {
        id: DRIVER_CLOSED_SOLICITAR_ID,
        title: "🚕 Solicitar servicio",
      },
    ],
  );
}

/**
 * Sprint 1.3: login solo con contraseña.
 * El conductor se identifica por el WhatsApp del mensaje (no se pide cédula).
 */
export async function startDriverLogin(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_LOGIN_PASSWORD",
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendButtonsMessage(
    phone,
    [
      "🔐 Iniciar sesión",
      "",
      "Escribe tu contraseña.",
    ].join("\n"),
    [
      {
        id: DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD,
        title: "Olvidé contraseña",
      },
    ],
  );
}

export function isDriverAuthButton(
  button: string | null | undefined,
): button is
  | typeof DRIVER_AUTH_BUTTON_IDS.LOGIN
  | typeof DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD
  | typeof DRIVER_AUTH_BUTTON_IDS.LOGOUT {
  return (
    button === DRIVER_AUTH_BUTTON_IDS.LOGIN ||
    button === DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD ||
    button === DRIVER_AUTH_BUTTON_IDS.LOGOUT
  );
}

export function isDriverLoginState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_LOGIN_DOCUMENT" ||
    session?.state === "DRIVER_LOGIN_PASSWORD"
  );
}

export async function getActiveLoginSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverLoginState(session) ? session : undefined;
}

export async function handleDriverAuthButton(
  phone: string,
  button: string,
): Promise<boolean> {
  if (button === DRIVER_AUTH_BUTTON_IDS.LOGIN) {
    const driver = await findDriverByPhone(phone);
    if (!driver) {
      await sendTextMessage(
        phone,
        "No encontramos tu registro de conductor. Envía 🚖 o 🚕 para registrarte.",
      );
      return true;
    }
    if (driverNeedsPasswordSetup(driver)) {
      await startExistingDriverPasswordSetup(phone, driver);
      return true;
    }
    await startDriverLogin(phone);
    return true;
  }

  if (button === DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD) {
    await sendTextMessage(
      phone,
      "🔄 El restablecimiento de contraseña estará disponible en una próxima actualización.\n\nPor ahora, si no puedes acceder, comunícate con un administrador de WhatXia.",
    );
    return true;
  }

  if (button === DRIVER_AUTH_BUTTON_IDS.LOGOUT) {
    await handleDriverLogout(phone);
    return true;
  }

  return false;
}

export async function handleDriverLogout(phone: string): Promise<void> {
  const driver = await getAuthenticatedDriver(phone);

  if (driver?.is_available) {
    await setDriverAvailability(driver.id, false);
  }

  await clearDriverAuthSession(phone);
  await clearSession(phone);

  await sendTextMessage(
    phone,
    [
      "✅ Tu sesión ha finalizado correctamente.",
      "",
      "Gracias por tu apoyo el día de hoy. Te esperamos nuevamente en WhatXia Mobility.",
    ].join("\n"),
  );

  await sendDriverClosedSessionMenu(phone);
}

/**
 * Exige sesión autenticada para acciones del menú conductor.
 * Si no hay sesión → menú cerrado.
 */
export async function requireDriverAuthenticated(
  phone: string,
): Promise<DriverRow | null> {
  const driver = await getAuthenticatedDriver(phone);
  if (!driver) {
    await sendTextMessage(
      phone,
      "Debes iniciar sesión para usar el menú de conductor.",
    );
    await sendDriverClosedSessionMenu(phone);
    return null;
  }
  return driver;
}

export async function continueDriverLogin(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isDriverLoginState(session)) {
    return false;
  }

  if (message.button === DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD) {
    await handleDriverAuthButton(message.phone, message.button);
    return true;
  }

  // Sesiones antiguas en DRIVER_LOGIN_DOCUMENT → redirigir a solo contraseña.
  if (session.state === "DRIVER_LOGIN_DOCUMENT") {
    await startDriverLogin(message.phone);
    return true;
  }

  if (!message.text) {
    await sendButtonsMessage(message.phone, "Escribe tu contraseña.", [
      {
        id: DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD,
        title: "Olvidé contraseña",
      },
    ]);
    return true;
  }

  const text = message.text.trim();
  if (text === "🚖" || text === "🚕") {
    await sendDriverClosedSessionMenu(message.phone);
    await clearSession(message.phone);
    return true;
  }

  // Identificación por WhatsApp + validación de contraseña.
  const driver = await findDriverByPhone(message.phone);
  const passwordOk =
    driver?.password_hash != null &&
    (await verifyPassword(text, driver.password_hash));

  if (!driver || !passwordOk) {
    await upsertSession(message.phone, {
      state: "DRIVER_LOGIN_PASSWORD",
      driverDraft: null,
      driverFlowStep: null,
    });
    await sendTextMessage(
      message.phone,
      "❌ Contraseña incorrecta. Intenta de nuevo.",
    );
    await sendButtonsMessage(message.phone, "Escribe tu contraseña.", [
      {
        id: DRIVER_AUTH_BUTTON_IDS.FORGOT_PASSWORD,
        title: "Olvidé contraseña",
      },
    ]);
    return true;
  }

  await clearSession(message.phone);
  await createDriverAuthSession(message.phone, driver.id);
  await sendTextMessage(message.phone, "✅ Sesión iniciada correctamente.");
  await sendDriverMainMenu(driver, message.phone, { welcome: true });
  return true;
}

export function isDriverPasswordSetupState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_PASSWORD_CREATE" ||
    session?.state === "DRIVER_PASSWORD_CONFIRM"
  );
}

export async function getActivePasswordSetupSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverPasswordSetupState(session) ? session : undefined;
}

export function driverNeedsPasswordSetup(driver: DriverRow): boolean {
  return !driver.password_hash;
}

/** Conductor existente sin password_hash → crear contraseña. */
export async function startExistingDriverPasswordSetup(
  phone: string,
  driver: DriverRow,
): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_PASSWORD_CREATE",
    driverName: driver.name,
    driverDraft: {
      document_id: driver.document_id ?? undefined,
      name: driver.name,
    },
    driverFlowStep: "existing",
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendTextMessage(
    phone,
    [
      "🔐 Configuración de acceso",
      "",
      "Para continuar, debes crear una contraseña de acceso a WhatXia.",
      "",
      "Escribe tu contraseña (mínimo 8 caracteres).",
    ].join("\n"),
  );
}

/** Tras el último campo del registro → pedir contraseña antes de crear el driver. */
export async function beginRegistrationPasswordSetup(
  phone: string,
  draft: DriverDraft,
  driverName: string | null,
): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_PASSWORD_CREATE",
    driverDraft: stripPendingPassword(draft),
    driverFlowStep: "registration",
    driverName,
    bookingDraft: null,
  });

  await sendTextMessage(
    phone,
    [
      "🔐 Último paso: crea tu contraseña de acceso",
      "",
      "Escribe una contraseña (mínimo 8 caracteres).",
    ].join("\n"),
  );
}

async function finishNewDriverRegistration(
  phone: string,
  draft: DriverDraft,
  plainPassword: string,
): Promise<void> {
  const input = draftToCreateInput(phone, draft);
  if (!input) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      "Faltan datos del registro. Envía 🚖 o 🚕 para reiniciar.",
    );
    return;
  }

  const passwordHash = await hashPassword(plainPassword);
  const documentId = draft.document_id ?? "";

  try {
    const { documentsExpired } = await createDriver({
      ...input,
      password_hash: passwordHash,
    });
    await clearSession(phone);

    await sendTextMessage(phone, credentialsMessage(documentId, plainPassword));

    if (documentsExpired) {
      await sendExpiredDocumentsPrompt(phone, EXPIRED_DOCS_MESSAGE);
      return;
    }

    await sendTextMessage(
      phone,
      [
        "Ya recibimos tu información.",
        "",
        "Ahora nuestro equipo realizará la validación correspondiente para activar tu cuenta como conductor de WhatXia.",
        "",
        "Una vez sea aprobada, podrás iniciar sesión enviando 🚖 o 🚕.",
      ].join("\n"),
    );
    await sendDriverClosedSessionMenu(phone);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "23505") {
      await clearSession(phone);
      await sendTextMessage(
        phone,
        "Este conductor ya se encuentra registrado en WhatXia. Si necesitas actualizar tus datos, comunícate con un administrador.",
      );
      return;
    }
    throw error;
  }
}

async function finishExistingDriverPassword(
  phone: string,
  draft: DriverDraft,
  plainPassword: string,
): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      "No encontramos tu registro. Envía 🚖 o 🚕 para continuar.",
    );
    return;
  }

  const passwordHash = await hashPassword(plainPassword);
  const updated = await updateDriverPasswordHash(driver.id, passwordHash);
  await clearSession(phone);

  const documentId =
    draft.document_id ?? updated?.document_id ?? driver.document_id ?? "";

  await sendTextMessage(phone, credentialsMessage(documentId, plainPassword));

  const latest = updated ?? { ...driver, password_hash: passwordHash };
  await createDriverAuthSession(phone, latest.id);
  await sendDriverMainMenu(latest, phone, { welcome: true });
}

export async function continueDriverPasswordSetup(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isDriverPasswordSetupState(session)) {
    return false;
  }

  const mode = session.driverFlowStep === "existing" ? "existing" : "registration";

  if (!message.text) {
    if (session.state === "DRIVER_PASSWORD_CONFIRM") {
      await sendTextMessage(
        message.phone,
        "Confirma tu contraseña escribiéndola de nuevo.",
      );
    } else {
      await sendTextMessage(
        message.phone,
        "Escribe tu contraseña (mínimo 8 caracteres).",
      );
    }
    return true;
  }

  const plain = message.text;
  const trimmedIntent = plain.trim();
  if (trimmedIntent === "🚖" || trimmedIntent === "🚕") {
    await sendTextMessage(
      message.phone,
      session.state === "DRIVER_PASSWORD_CONFIRM"
        ? "Confirma tu contraseña escribiéndola de nuevo."
        : "Escribe tu contraseña (mínimo 8 caracteres).",
    );
    return true;
  }

  if (session.state === "DRIVER_PASSWORD_CREATE") {
    const error = validatePasswordPlain(plain);
    if (error) {
      await sendTextMessage(message.phone, error);
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_PASSWORD_CONFIRM",
      driverDraft: withPendingPassword(session.driverDraft, plain),
      driverFlowStep: session.driverFlowStep,
      driverName: session.driverName,
    });

    await sendTextMessage(
      message.phone,
      "Confirma tu contraseña escribiéndola de nuevo.",
    );
    return true;
  }

  // DRIVER_PASSWORD_CONFIRM
  const pending = getPendingPassword(session.driverDraft);
  if (!pending) {
    await upsertSession(message.phone, {
      state: "DRIVER_PASSWORD_CREATE",
      driverDraft: stripPendingPassword(session.driverDraft),
      driverFlowStep: session.driverFlowStep,
      driverName: session.driverName,
    });
    await sendTextMessage(
      message.phone,
      "No pudimos validar la contraseña. Escribe una nueva (mínimo 8 caracteres).",
    );
    return true;
  }

  if (plain !== pending) {
    await upsertSession(message.phone, {
      state: "DRIVER_PASSWORD_CREATE",
      driverDraft: stripPendingPassword(session.driverDraft),
      driverFlowStep: session.driverFlowStep,
      driverName: session.driverName,
    });
    await sendTextMessage(
      message.phone,
      "Las contraseñas no coinciden. Escribe una nueva contraseña (mínimo 8 caracteres).",
    );
    return true;
  }

  const cleanDraft = stripPendingPassword(session.driverDraft);

  if (mode === "existing") {
    await finishExistingDriverPassword(message.phone, cleanDraft, plain);
  } else {
    await finishNewDriverRegistration(message.phone, cleanDraft, plain);
  }

  return true;
}

/**
 * Entrada al módulo conductor:
 * 1) Sin password_hash → setup (Fase 1).
 * 2) Con sesión autenticada → menú operativo.
 * 3) Sin sesión → menú cerrado (Iniciar sesión / Solicitar servicio).
 */
export async function routeAuthenticatedDriverEntry(
  phone: string,
  driver: DriverRow,
): Promise<void> {
  if (driverNeedsPasswordSetup(driver)) {
    await startExistingDriverPasswordSetup(phone, driver);
    console.log("[driver-auth] conductor sin contraseña → setup", { phone });
    return;
  }

  const authenticated = await getAuthenticatedDriver(phone);
  if (authenticated && authenticated.id === driver.id) {
    await sendDriverMainMenu(authenticated, phone);
    console.log("[driver-auth] sesión iniciada → menú", { phone });
    return;
  }

  await sendDriverClosedSessionMenu(phone);
  console.log("[driver-auth] sesión cerrada → login/solicitar", { phone });
}
