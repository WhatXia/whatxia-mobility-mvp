/**
 * DRIVER-004 — Actualización conversacional de datos del conductor
 * (confirmación previa, gate de correo, post-menú).
 */

import type { IncomingMessage, UserSession, DriverDraft } from "@/types";
import {
  CATEGORY_FIELDS,
  DRIVER_FIELDS,
  PERSONAL_UPDATE_OPTIONS,
  formatDateForDisplay,
  validateDriverField,
  type DriverFieldCategory,
  type DriverFieldKey,
} from "@/lib/driver-profile-fields";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  findDriverByPhone,
  updateDriverField,
  type DriverRow,
} from "@/lib/supabase/drivers";
import {
  EXPIRED_DOCS_MESSAGE,
  hasExpiredDocuments,
} from "@/lib/driver-documents";
import { syncDriverDocumentStatus } from "@/lib/document-jobs";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import { verifyPassword } from "@/lib/driver-password";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import { startDriverPhoneChange } from "@/lib/driver-phone-change";
import { sendDriverMainMenu } from "@/lib/driver-menu";

export const UPDATE_CATEGORY_IDS = {
  PERSONAL: "update_cat_personal",
  VEHICLE: "update_cat_vehicle",
  DOCUMENTS: "update_cat_documents",
} as const;

export const UPDATE_FLOW_BUTTON_IDS = {
  CONFIRM_YES: "update_confirm_yes",
  CONFIRM_NO: "update_confirm_no",
  POST_ANOTHER_PERSONAL: "update_post_another_personal",
  POST_DRIVER_MENU: "update_post_driver_menu",
  POST_MAIN_MENU: "update_post_main_menu",
} as const;

const PENDING_VALUE_KEY = "__pending_value";
const EMAIL_PW_ATTEMPTS_KEY = "__email_pw_attempts";
const MAX_EMAIL_PASSWORD_ATTEMPTS = 3;

type DraftWithPending = DriverDraft & {
  [PENDING_VALUE_KEY]?: string;
  [EMAIL_PW_ATTEMPTS_KEY]?: number;
};

function isFieldKey(value: string | null): value is DriverFieldKey {
  return Boolean(value && value in DRIVER_FIELDS);
}

function isCategory(value: string | null): value is DriverFieldCategory {
  return value === "personal" || value === "vehicle" || value === "documents";
}

function displayFieldValue(driver: DriverRow, key: DriverFieldKey): string {
  const value = driver[key];

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (
    key === "soat_expires_at" ||
    key === "techno_expires_at" ||
    key === "operation_expires_at" ||
    key === "license_expires_at"
  ) {
    return formatDateForDisplay(String(value));
  }

  return String(value);
}

function displayName(driver: DriverRow): string {
  return driver.full_name?.trim() || driver.name || "—";
}

function getPendingValue(draft: UserSession["driverDraft"]): string | null {
  const value = (draft as DraftWithPending | null | undefined)?.[PENDING_VALUE_KEY];
  return typeof value === "string" ? value : null;
}

function withPendingValue(
  draft: UserSession["driverDraft"],
  value: string,
): DraftWithPending {
  return {
    ...((draft as DraftWithPending | null) ?? {}),
    [PENDING_VALUE_KEY]: value,
  };
}

function getEmailAttempts(draft: UserSession["driverDraft"]): number {
  const value = (draft as DraftWithPending | null | undefined)?.[
    EMAIL_PW_ATTEMPTS_KEY
  ];
  return typeof value === "number" && value >= 0 ? value : 0;
}

function withEmailAttempts(
  draft: UserSession["driverDraft"],
  attempts: number,
): DraftWithPending {
  return {
    ...((draft as DraftWithPending | null) ?? {}),
    [EMAIL_PW_ATTEMPTS_KEY]: attempts,
  };
}

async function sendPersonalFieldList(phone: string, driver: DriverRow) {
  const lines = PERSONAL_UPDATE_OPTIONS.map((option, index) => {
    const n = index + 1;
    if (option.kind === "whatsapp") {
      return `${n}. Número de WhatsApp: ${driver.phone || "—"}`;
    }
    if (option.kind === "readonly") {
      const label = DRIVER_FIELDS[option.key].label;
      const value =
        option.key === "name"
          ? displayName(driver)
          : displayFieldValue(driver, option.key);
      return `${n}. ${label}: ${value} (solo lectura)`;
    }
    return `${n}. ${DRIVER_FIELDS[option.key].label}: ${displayFieldValue(driver, option.key)}`;
  });

  await sendTextMessage(
    phone,
    [
      "👤 Datos personales",
      "",
      ...lines,
      "",
      "Escribe el número del dato que quieres actualizar.",
    ].join("\n"),
  );
}

async function sendCategoryFieldList(
  phone: string,
  driver: DriverRow,
  category: DriverFieldCategory,
) {
  if (category === "personal") {
    await sendPersonalFieldList(phone, driver);
    return;
  }

  const fields = CATEGORY_FIELDS[category];
  const lines = fields.map((key, index) => {
    const field = DRIVER_FIELDS[key];
    return `${index + 1}. ${field.label}: ${displayFieldValue(driver, key)}`;
  });

  await sendTextMessage(
    phone,
    [
      "Sección seleccionada.",
      "",
      ...lines,
      "",
      "Escribe el número del dato que quieres actualizar.",
    ].join("\n"),
  );
}

export async function startDriverUpdate(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  await upsertSession(phone, {
    state: "DRIVER_UPDATE_CATEGORY",
    driverUpdateCategory: null,
    driverUpdateField: null,
    driverFlowStep: null,
    driverDraft: null,
  });

  await sendButtonsMessage(
    phone,
    "✏️ Actualizar datos\n\n¿Qué sección deseas modificar?",
    [
      { id: UPDATE_CATEGORY_IDS.PERSONAL, title: "👤 Datos personales" },
      { id: UPDATE_CATEGORY_IDS.VEHICLE, title: "🚗 Vehículo" },
      { id: UPDATE_CATEGORY_IDS.DOCUMENTS, title: "📄 Documentos" },
    ],
  );
}

export async function openPersonalDataUpdate(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  await upsertSession(phone, {
    state: "DRIVER_UPDATE_SELECT_FIELD",
    driverUpdateCategory: "personal",
    driverUpdateField: null,
    driverDraft: null,
    driverFlowStep: null,
  });

  await sendPersonalFieldList(phone, driver);
}

export async function handleUpdateCategorySelection(
  phone: string,
  buttonId: string,
): Promise<boolean> {
  let category: DriverFieldCategory | null = null;

  if (buttonId === UPDATE_CATEGORY_IDS.PERSONAL) {
    category = "personal";
  } else if (buttonId === UPDATE_CATEGORY_IDS.VEHICLE) {
    category = "vehicle";
  } else if (buttonId === UPDATE_CATEGORY_IDS.DOCUMENTS) {
    category = "documents";
  }

  if (!category) {
    return false;
  }

  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return true;
  }

  await upsertSession(phone, {
    state: "DRIVER_UPDATE_SELECT_FIELD",
    driverUpdateCategory: category,
    driverUpdateField: null,
    driverDraft: null,
  });

  await sendCategoryFieldList(phone, driver, category);
  return true;
}

async function sendConfirmPrompt(
  phone: string,
  fieldKey: DriverFieldKey,
  currentValue: string,
  newValue: string,
) {
  await sendButtonsMessage(
    phone,
    [
      `Vas a cambiar tu ${DRIVER_FIELDS[fieldKey].label.toLowerCase()}.`,
      "",
      `Valor actual: ${currentValue}`,
      `Nuevo valor: ${newValue}`,
      "",
      "¿Deseas confirmar?",
    ].join("\n"),
    [
      { id: UPDATE_FLOW_BUTTON_IDS.CONFIRM_YES, title: "✅ Confirmar" },
      { id: UPDATE_FLOW_BUTTON_IDS.CONFIRM_NO, title: "❌ Cancelar" },
    ],
  );
}

export async function sendPostUpdateMenu(phone: string): Promise<void> {
  await sendButtonsMessage(
    phone,
    "✅ Tu información fue actualizada correctamente.",
    [
      {
        id: UPDATE_FLOW_BUTTON_IDS.POST_ANOTHER_PERSONAL,
        title: "Otro dato personal",
      },
      {
        id: UPDATE_FLOW_BUTTON_IDS.POST_DRIVER_MENU,
        title: "Menú conductor",
      },
      {
        id: UPDATE_FLOW_BUTTON_IDS.POST_MAIN_MENU,
        title: "Menú principal",
      },
    ],
  );
}

async function afterSuccessfulFieldUpdate(
  phone: string,
  updated: DriverRow,
  fieldKey: DriverFieldKey,
): Promise<void> {
  // No cerrar conversación: solo limpiar estado de update y ofrecer navegación.
  await clearSession(phone);

  const isDocumentField =
    fieldKey === "soat_expires_at" ||
    fieldKey === "techno_expires_at" ||
    fieldKey === "license_expires_at" ||
    fieldKey === "operation_expires_at";

  if (isDocumentField || hasExpiredDocuments(updated) || updated.documents_blocked) {
    const sync = await syncDriverDocumentStatus(updated);

    if (sync.blockedNow || hasExpiredDocuments(sync.driver)) {
      await sendExpiredDocumentsPrompt(phone, EXPIRED_DOCS_MESSAGE);
      return;
    }
    if (sync.unblockedNow) {
      await sendTextMessage(
        phone,
        "✅ Tus documentos quedaron al día. Cuando quieras, actívate como Disponible desde tu menú.",
      );
    }
  }

  await sendPostUpdateMenu(phone);
}

export async function continueDriverUpdate(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (session.state === "DRIVER_UPDATE_SELECT_FIELD") {
    if (!message.text) {
      return false;
    }

    const category = session.driverUpdateCategory;
    if (!isCategory(category)) {
      await clearSession(message.phone);
      await sendTextMessage(
        message.phone,
        "La actualización se interrumpió. Entra a Mis datos y vuelve a intentar.",
      );
      return true;
    }

    const index = Number(message.text.trim()) - 1;

    if (category === "personal") {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= PERSONAL_UPDATE_OPTIONS.length
      ) {
        await sendTextMessage(
          message.phone,
          `Escribe un número entre 1 y ${PERSONAL_UPDATE_OPTIONS.length}.`,
        );
        return true;
      }

      const option = PERSONAL_UPDATE_OPTIONS[index];
      if (option.kind === "readonly") {
        await sendTextMessage(
          message.phone,
          `🔒 ${DRIVER_FIELDS[option.key].label} es solo lectura y no se puede modificar desde WhatsApp.`,
        );
        const driver = await findDriverByPhone(message.phone);
        if (driver) {
          await sendPersonalFieldList(message.phone, driver);
        }
        return true;
      }

      if (option.kind === "whatsapp") {
        await startDriverPhoneChange(message.phone);
        return true;
      }

      const fieldKey = option.key;
      if (fieldKey === "email") {
        await upsertSession(message.phone, {
          state: "DRIVER_UPDATE_EMAIL_PASSWORD",
          driverUpdateCategory: category,
          driverUpdateField: fieldKey,
          driverDraft: withEmailAttempts(null, 0),
        });
        await sendTextMessage(
          message.phone,
          "Por seguridad, escribe tu contraseña actual para cambiar el correo electrónico.",
        );
        return true;
      }

      await upsertSession(message.phone, {
        state: "DRIVER_UPDATE_VALUE",
        driverUpdateCategory: category,
        driverUpdateField: fieldKey,
        driverDraft: null,
      });
      await sendTextMessage(message.phone, DRIVER_FIELDS[fieldKey].prompt);
      return true;
    }

    const fields = CATEGORY_FIELDS[category];
    if (!Number.isInteger(index) || index < 0 || index >= fields.length) {
      await sendTextMessage(
        message.phone,
        `Escribe un número entre 1 y ${fields.length}.`,
      );
      return true;
    }

    const fieldKey = fields[index];
    await upsertSession(message.phone, {
      state: "DRIVER_UPDATE_VALUE",
      driverUpdateCategory: category,
      driverUpdateField: fieldKey,
      driverDraft: null,
    });
    await sendTextMessage(message.phone, DRIVER_FIELDS[fieldKey].prompt);
    return true;
  }

  if (session.state === "DRIVER_UPDATE_EMAIL_PASSWORD") {
    if (!message.text) {
      await sendTextMessage(
        message.phone,
        "Por seguridad, escribe tu contraseña actual para cambiar el correo electrónico.",
      );
      return true;
    }

    const driver = await findDriverByPhone(message.phone);
    if (!driver?.password_hash) {
      await clearSession(message.phone);
      await sendTextMessage(
        message.phone,
        "No encontramos una contraseña configurada. Inicia sesión o restablécela e intenta de nuevo.",
      );
      return true;
    }

    const ok = await verifyPassword(message.text, driver.password_hash);
    if (!ok) {
      const attempts = getEmailAttempts(session.driverDraft) + 1;
      if (attempts >= MAX_EMAIL_PASSWORD_ATTEMPTS) {
        await clearSession(message.phone);
        await sendTextMessage(
          message.phone,
          "Has superado el máximo de intentos de contraseña. El cambio de correo fue cancelado.",
        );
        await startDriverUpdate(message.phone);
        return true;
      }

      await upsertSession(message.phone, {
        state: "DRIVER_UPDATE_EMAIL_PASSWORD",
        driverUpdateField: "email",
        driverUpdateCategory: "personal",
        driverDraft: withEmailAttempts(session.driverDraft, attempts),
      });
      await sendTextMessage(
        message.phone,
        `❌ Contraseña incorrecta. Intento ${attempts} de ${MAX_EMAIL_PASSWORD_ATTEMPTS}.`,
      );
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_UPDATE_VALUE",
      driverUpdateCategory: "personal",
      driverUpdateField: "email",
      driverDraft: null,
    });
    await sendTextMessage(message.phone, DRIVER_FIELDS.email.prompt);
    return true;
  }

  if (session.state === "DRIVER_UPDATE_VALUE") {
    if (!message.text) {
      return false;
    }

    const fieldKey = session.driverUpdateField;
    if (!isFieldKey(fieldKey)) {
      await clearSession(message.phone);
      await sendTextMessage(
        message.phone,
        "La actualización se interrumpió. Entra a Mis datos y vuelve a intentar.",
      );
      return true;
    }

    const parsed = validateDriverField(fieldKey, message.text);
    if (!parsed.ok) {
      await sendTextMessage(message.phone, parsed.error);
      await sendTextMessage(message.phone, DRIVER_FIELDS[fieldKey].prompt);
      return true;
    }

    const driver = await findDriverByPhone(message.phone);
    if (!driver) {
      await clearSession(message.phone);
      await sendTextMessage(
        message.phone,
        "No encontramos tu registro de conductor.",
      );
      return true;
    }

    const newDisplay =
      fieldKey === "soat_expires_at" ||
      fieldKey === "techno_expires_at" ||
      fieldKey === "operation_expires_at" ||
      fieldKey === "license_expires_at"
        ? formatDateForDisplay(String(parsed.value))
        : String(parsed.value);

    await upsertSession(message.phone, {
      state: "DRIVER_UPDATE_CONFIRM",
      driverUpdateCategory: session.driverUpdateCategory,
      driverUpdateField: fieldKey,
      driverDraft: withPendingValue(null, String(parsed.value)),
    });

    await sendConfirmPrompt(
      message.phone,
      fieldKey,
      displayFieldValue(driver, fieldKey),
      newDisplay,
    );
    return true;
  }

  return false;
}

export async function handleUpdateFlowButton(
  phone: string,
  buttonId: string,
): Promise<boolean> {
  if (buttonId === UPDATE_FLOW_BUTTON_IDS.CONFIRM_YES) {
    const session = await getSession(phone);
    if (session?.state !== "DRIVER_UPDATE_CONFIRM") {
      return false;
    }

    const fieldKey = session.driverUpdateField;
    const pending = getPendingValue(session.driverDraft);
    if (!isFieldKey(fieldKey) || pending == null) {
      await clearSession(phone);
      await sendTextMessage(
        phone,
        "La confirmación expiró. Entra a Mis datos y vuelve a intentar.",
      );
      return true;
    }

    const driver = await findDriverByPhone(phone);
    if (!driver) {
      await clearSession(phone);
      await sendTextMessage(phone, "No encontramos tu registro de conductor.");
      return true;
    }

    const parsed = validateDriverField(fieldKey, pending);
    if (!parsed.ok) {
      await clearSession(phone);
      await sendTextMessage(phone, parsed.error);
      return true;
    }

    const updated = await updateDriverField(driver.id, fieldKey, parsed.value);
    if (!updated) {
      await sendTextMessage(
        phone,
        "No se pudo guardar el cambio. Intenta de nuevo.",
      );
      return true;
    }

    await afterSuccessfulFieldUpdate(phone, updated, fieldKey);
    return true;
  }

  if (buttonId === UPDATE_FLOW_BUTTON_IDS.CONFIRM_NO) {
    const session = await getSession(phone);
    const category = session?.driverUpdateCategory ?? null;
    await clearSession(phone);

    await sendTextMessage(phone, "Actualización cancelada. No se guardaron cambios.");

    if (isCategory(category)) {
      await upsertSession(phone, {
        state: "DRIVER_UPDATE_SELECT_FIELD",
        driverUpdateCategory: category,
        driverUpdateField: null,
        driverDraft: null,
      });
      const driver = await findDriverByPhone(phone);
      if (driver) {
        await sendCategoryFieldList(phone, driver, category);
      }
    } else {
      await startDriverUpdate(phone);
    }
    return true;
  }

  if (buttonId === UPDATE_FLOW_BUTTON_IDS.POST_ANOTHER_PERSONAL) {
    await openPersonalDataUpdate(phone);
    return true;
  }

  if (buttonId === UPDATE_FLOW_BUTTON_IDS.POST_DRIVER_MENU) {
    const driver = await findDriverByPhone(phone);
    if (!driver) {
      await sendTextMessage(phone, "No encontramos tu registro de conductor.");
      return true;
    }
    await clearSession(phone);
    await sendDriverMainMenu(driver, phone);
    return true;
  }

  if (buttonId === UPDATE_FLOW_BUTTON_IDS.POST_MAIN_MENU) {
    await clearSession(phone);
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    const driver = await findDriverByPhone(phone);
    await sendPassengerActionMenu(phone, driver?.preferred_name || driver?.name || "");
    return true;
  }

  return false;
}

export function isUpdateFlowButton(button: string | null | undefined): boolean {
  if (!button) return false;
  return (
    button === UPDATE_FLOW_BUTTON_IDS.CONFIRM_YES ||
    button === UPDATE_FLOW_BUTTON_IDS.CONFIRM_NO ||
    button === UPDATE_FLOW_BUTTON_IDS.POST_ANOTHER_PERSONAL ||
    button === UPDATE_FLOW_BUTTON_IDS.POST_DRIVER_MENU ||
    button === UPDATE_FLOW_BUTTON_IDS.POST_MAIN_MENU
  );
}

export function isDriverUpdateState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_UPDATE_CATEGORY" ||
    session?.state === "DRIVER_UPDATE_SELECT_FIELD" ||
    session?.state === "DRIVER_UPDATE_VALUE" ||
    session?.state === "DRIVER_UPDATE_EMAIL_PASSWORD" ||
    session?.state === "DRIVER_UPDATE_CONFIRM"
  );
}

export async function getActiveUpdateSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverUpdateState(session) ? session : undefined;
}
