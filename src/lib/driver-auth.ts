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
  driverHasPreferredName,
  findDriverByPhone,
  setDriverAvailability,
  updateDriverPasswordHash,
  updateDriverPreferredName,
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
import {
  findPassengerByPhone,
  setPassengerPreferredName,
} from "@/lib/supabase/passengers";
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
const RESET_STARTED_AT_KEY = "__reset_started_at";
const RESET_ATTEMPTS_KEY = "__reset_attempts";

const RESET_TIMEOUT_MS = 10 * 60 * 1000;
const RESET_MAX_DOCUMENT_ATTEMPTS = 3;

type DraftWithPending = DriverDraft & {
  [PENDING_PASSWORD_KEY]?: string;
  [RESET_STARTED_AT_KEY]?: string;
  [RESET_ATTEMPTS_KEY]?: number;
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

function normalizeDocumentId(raw: string): string {
  return raw.replace(/\D/g, "");
}

function getResetStartedAt(draft: DriverDraft | null | undefined): number | null {
  const raw = (draft as DraftWithPending | null | undefined)?.[RESET_STARTED_AT_KEY];
  if (typeof raw !== "string" || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function getResetAttempts(draft: DriverDraft | null | undefined): number {
  const value = (draft as DraftWithPending | null | undefined)?.[RESET_ATTEMPTS_KEY];
  return typeof value === "number" && value >= 0 ? value : 0;
}

function withResetMeta(
  draft: DriverDraft | null | undefined,
  meta: { startedAt?: string; attempts?: number },
): DraftWithPending {
  const current = (draft ?? {}) as DraftWithPending;
  return {
    ...current,
    [RESET_STARTED_AT_KEY]:
      meta.startedAt ?? current[RESET_STARTED_AT_KEY] ?? new Date().toISOString(),
    [RESET_ATTEMPTS_KEY]:
      meta.attempts ?? current[RESET_ATTEMPTS_KEY] ?? 0,
  };
}

async function cancelPasswordReset(
  phone: string,
  reasonMessage: string,
): Promise<void> {
  await clearSession(phone);
  await sendTextMessage(phone, reasonMessage);
  await startDriverLogin(phone);
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

export function isDriverPasswordResetState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_RESET_DOCUMENT" ||
    session?.state === "DRIVER_RESET_PASSWORD" ||
    session?.state === "DRIVER_RESET_CONFIRM"
  );
}

export async function getActivePasswordResetSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverPasswordResetState(session) ? session : undefined;
}

/**
 * AUTH-WA-001: restablecimiento conversacional (documento → nueva clave → hash).
 * Sin correo, enlaces ni OTP.
 */
export async function startDriverPasswordReset(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(
      phone,
      "No encontramos tu registro de conductor. Envía 🚖 o 🚕 para registrarte.",
    );
    return;
  }

  if (driverNeedsPasswordSetup(driver)) {
    await startExistingDriverPasswordSetup(phone, driver);
    return;
  }

  await upsertSession(phone, {
    state: "DRIVER_RESET_DOCUMENT",
    driverDraft: withResetMeta(null, {
      startedAt: new Date().toISOString(),
      attempts: 0,
    }),
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendTextMessage(
    phone,
    "Para verificar tu identidad necesito tu número de documento registrado en WhatXia.",
  );

  console.log("[driver-auth:reset] inicio", { phone });
}

export async function continueDriverPasswordReset(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isDriverPasswordResetState(session)) {
    return false;
  }

  const lastActivityAt = getResetStartedAt(session.driverDraft);
  if (
    lastActivityAt != null &&
    Date.now() - lastActivityAt > RESET_TIMEOUT_MS
  ) {
    await cancelPasswordReset(
      message.phone,
      "⏱️ Se agotó el tiempo para restablecer la contraseña (10 minutos sin respuesta). Inténtalo de nuevo.",
    );
    return true;
  }

  // Renovar actividad en cada mensaje del flujo (timeout = 10 min sin respuesta).
  const touchActivity = () =>
    withResetMeta(session.driverDraft, {
      startedAt: new Date().toISOString(),
    });

  const intent = message.text?.trim() ?? "";
  if (intent === "🚖" || intent === "🚕") {
    await clearSession(message.phone);
    await sendDriverClosedSessionMenu(message.phone);
    return true;
  }

  if (session.state === "DRIVER_RESET_DOCUMENT") {
    if (!message.text?.trim()) {
      await upsertSession(message.phone, {
        state: "DRIVER_RESET_DOCUMENT",
        driverDraft: touchActivity(),
      });
      await sendTextMessage(
        message.phone,
        "Para verificar tu identidad necesito tu número de documento registrado en WhatXia.",
      );
      return true;
    }

    const documentDigits = normalizeDocumentId(message.text);
    const driver = await findDriverByPhone(message.phone);
    const registeredDoc = normalizeDocumentId(driver?.document_id ?? "");
    const matches =
      Boolean(driver) &&
      Boolean(documentDigits) &&
      registeredDoc.length > 0 &&
      documentDigits === registeredDoc;

    if (!matches) {
      const attempts = getResetAttempts(session.driverDraft) + 1;
      if (attempts >= RESET_MAX_DOCUMENT_ATTEMPTS) {
        await cancelPasswordReset(
          message.phone,
          "Has superado el máximo de intentos de verificación. Por seguridad, el restablecimiento fue cancelado. Comunícate con un administrador si necesitas ayuda.",
        );
        console.log("[driver-auth:reset] documento bloqueado por intentos", {
          phone: message.phone,
          attempts,
        });
        return true;
      }

      await upsertSession(message.phone, {
        state: "DRIVER_RESET_DOCUMENT",
        driverDraft: withResetMeta(touchActivity(), { attempts }),
      });
      await sendTextMessage(
        message.phone,
        "El documento no coincide con el registrado en tu cuenta. Inténtalo nuevamente o comunícate con un administrador.",
      );
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_RESET_PASSWORD",
      driverDraft: withResetMeta(stripPendingPassword(touchActivity()), {
        attempts: getResetAttempts(session.driverDraft),
      }),
    });
    await sendTextMessage(message.phone, "Escribe tu nueva contraseña.");
    console.log("[driver-auth:reset] documento OK", { phone: message.phone });
    return true;
  }

  if (session.state === "DRIVER_RESET_PASSWORD") {
    if (!message.text) {
      await upsertSession(message.phone, {
        state: "DRIVER_RESET_PASSWORD",
        driverDraft: touchActivity(),
      });
      await sendTextMessage(message.phone, "Escribe tu nueva contraseña.");
      return true;
    }

    const plain = message.text;
    const error = validatePasswordPlain(plain);
    if (error) {
      await upsertSession(message.phone, {
        state: "DRIVER_RESET_PASSWORD",
        driverDraft: touchActivity(),
      });
      await sendTextMessage(message.phone, error);
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_RESET_CONFIRM",
      driverDraft: withPendingPassword(touchActivity(), plain),
    });
    await sendTextMessage(
      message.phone,
      "Confirma nuevamente tu contraseña.",
    );
    return true;
  }

  // DRIVER_RESET_CONFIRM
  if (!message.text) {
    await upsertSession(message.phone, {
      state: "DRIVER_RESET_CONFIRM",
      driverDraft: touchActivity(),
    });
    await sendTextMessage(
      message.phone,
      "Confirma nuevamente tu contraseña.",
    );
    return true;
  }

  const pending = getPendingPassword(session.driverDraft);
  if (!pending) {
    await upsertSession(message.phone, {
      state: "DRIVER_RESET_PASSWORD",
      driverDraft: withResetMeta(stripPendingPassword(touchActivity()), {}),
    });
    await sendTextMessage(message.phone, "Escribe tu nueva contraseña.");
    return true;
  }

  if (message.text !== pending) {
    // Solo re-pedir confirmación (no reiniciar desde la nueva contraseña).
    await upsertSession(message.phone, {
      state: "DRIVER_RESET_CONFIRM",
      driverDraft: touchActivity(),
    });
    await sendTextMessage(
      message.phone,
      "Las contraseñas no coinciden. Confirma nuevamente tu contraseña.",
    );
    return true;
  }

  const driver = await findDriverByPhone(message.phone);
  if (!driver) {
    await cancelPasswordReset(
      message.phone,
      "No encontramos tu registro de conductor. Envía 🚖 o 🚕 para continuar.",
    );
    return true;
  }

  const passwordHash = await hashPassword(pending);
  await updateDriverPasswordHash(driver.id, passwordHash);
  await clearSession(message.phone);

  await sendTextMessage(
    message.phone,
    [
      "✅ Tu contraseña fue actualizada correctamente.",
      "",
      "Ya puedes iniciar sesión nuevamente.",
    ].join("\n"),
  );

  await startDriverLogin(message.phone);

  console.log("[driver-auth:reset] contraseña actualizada", {
    phone: message.phone,
    driverId: driver.id,
  });
  return true;
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
    await startDriverPasswordReset(phone);
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
  await enterDriverAfterAuthentication(message.phone, driver);
  return true;
}

const DRIVER_PREFERRED_PROMPT = [
  "👋 Antes de continuar...",
  "",
  "¿Cómo prefieres que te llamemos?",
].join("\n");

export function isDriverPreferredNameState(
  session: UserSession | undefined,
): boolean {
  return session?.state === "DRIVER_PREFERRED_NAME";
}

export async function getActiveDriverPreferredNameSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverPreferredNameState(session) ? session : undefined;
}

async function promptDriverPreferredName(phone: string): Promise<void> {
  await upsertSession(phone, {
    state: "DRIVER_PREFERRED_NAME",
    driverDraft: null,
    driverFlowStep: null,
    bookingDraft: null,
  });
  await sendTextMessage(phone, DRIVER_PREFERRED_PROMPT);
}

/**
 * Tras autenticar (o con sesión activa): pedir preferred_name una sola vez, luego menú.
 */
export async function enterDriverAfterAuthentication(
  phone: string,
  driver: DriverRow,
): Promise<void> {
  if (!driverHasPreferredName(driver)) {
    // Reutilizar preferred_name del mismo WhatsApp (pasajero) si ya existe.
    const passenger = await findPassengerByPhone(phone);
    const fromPassenger = passenger?.preferred_name?.trim();
    if (fromPassenger) {
      const synced = await updateDriverPreferredName(driver.id, fromPassenger);
      const latest = synced ?? { ...driver, preferred_name: fromPassenger };
      await clearSession(phone);
      await sendDriverMainMenu(latest, phone, { welcome: true });
      console.log("[driver-auth] preferred_name sincronizado desde pasajero", {
        phone,
        preferredName: fromPassenger,
      });
      return;
    }

    await promptDriverPreferredName(phone);
    console.log("[driver-auth] pedir preferred_name", { phone });
    return;
  }

  await clearSession(phone);
  await sendDriverMainMenu(driver, phone, { welcome: true });
  console.log("[driver-auth] menú con preferred_name", {
    phone,
    preferredName: driver.preferred_name,
  });
}

export async function continueDriverPreferredName(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isDriverPreferredNameState(session)) {
    return false;
  }

  const driver = await getAuthenticatedDriver(message.phone);
  if (!driver) {
    await clearSession(message.phone);
    await sendDriverClosedSessionMenu(message.phone);
    return true;
  }

  const raw = message.text?.trim() ?? "";
  if (!raw || raw === "🚖" || raw === "🚕") {
    await sendTextMessage(
      message.phone,
      "¿Cómo prefieres que te llamemos? Escribe solo ese nombre (ej. Carlos).",
    );
    return true;
  }

  const preferred = raw.slice(0, 40);
  const updated = await updateDriverPreferredName(driver.id, preferred);
  // Espejo en pasajero (mismo WhatsApp) sin alterar el flujo de pasajeros nuevos.
  await setPassengerPreferredName(message.phone, preferred).catch(() => null);

  await clearSession(message.phone);
  await sendTextMessage(
    message.phone,
    "✅ Gracias. Tu nombre preferido ha sido registrado.",
  );

  const latest = updated ?? { ...driver, preferred_name: preferred };
  await sendDriverMainMenu(latest, message.phone, { welcome: true });

  console.log("[driver-auth] preferred_name registrado", {
    phone: message.phone,
    preferredName: preferred,
  });
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
  await enterDriverAfterAuthentication(phone, latest);
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
 * Entrada al módulo conductor (típicamente vía 🚖):
 * 1) Sin password_hash → setup.
 * 2) Con sesión autenticada → preferred_name (si falta) o menú.
 * 3) Sin sesión → pedir solo contraseña (WhatsApp ya identifica).
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
    await enterDriverAfterAuthentication(phone, authenticated);
    console.log("[driver-auth] sesión activa → post-auth", { phone });
    return;
  }

  await startDriverLogin(phone);
  console.log("[driver-auth] sin sesión → pedir contraseña", { phone });
}
