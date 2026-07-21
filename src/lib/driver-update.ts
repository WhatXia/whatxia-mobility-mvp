import type { IncomingMessage, UserSession } from "@/types";
import {
  CATEGORY_FIELDS,
  DRIVER_FIELDS,
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
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export const UPDATE_CATEGORY_IDS = {
  PERSONAL: "update_cat_personal",
  VEHICLE: "update_cat_vehicle",
  DOCUMENTS: "update_cat_documents",
} as const;

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
    key === "license_expires_at"
  ) {
    return formatDateForDisplay(String(value));
  }

  return String(value);
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

  const fields = CATEGORY_FIELDS[category];
  const lines = fields.map((key, index) => {
    const field = DRIVER_FIELDS[key];
    return `${index + 1}. ${field.label}: ${displayFieldValue(driver, key)}`;
  });

  await upsertSession(phone, {
    state: "DRIVER_UPDATE_SELECT_FIELD",
    driverUpdateCategory: category,
    driverUpdateField: null,
  });

  await sendTextMessage(
    phone,
    [
      `Sección seleccionada.`,
      "",
      ...lines,
      "",
      "Escribe el número del dato que quieres actualizar.",
    ].join("\n"),
  );

  return true;
}

export async function continueDriverUpdate(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!message.text) {
    return false;
  }

  if (session.state === "DRIVER_UPDATE_SELECT_FIELD") {
    const category = session.driverUpdateCategory;
    if (!isCategory(category)) {
      await clearSession(message.phone);
      await sendTextMessage(
        message.phone,
        "La actualización se interrumpió. Entra a Mis datos y vuelve a intentar.",
      );
      return true;
    }

    const fields = CATEGORY_FIELDS[category];
    const index = Number(message.text.trim()) - 1;

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
    });

    await sendTextMessage(message.phone, DRIVER_FIELDS[fieldKey].prompt);
    return true;
  }

  if (session.state === "DRIVER_UPDATE_VALUE") {
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

    const updated = await updateDriverField(
      driver.id,
      fieldKey,
      parsed.value,
    );

    if (!updated) {
      await sendTextMessage(
        message.phone,
        "No se pudo guardar el cambio. Intenta de nuevo.",
      );
      return true;
    }

    await clearSession(message.phone);

    await sendTextMessage(
      message.phone,
      `✅ ${DRIVER_FIELDS[fieldKey].label} actualizado correctamente.`,
    );

    const isDocumentField =
      fieldKey === "soat_expires_at" ||
      fieldKey === "techno_expires_at" ||
      fieldKey === "license_expires_at";

    if (isDocumentField || hasExpiredDocuments(updated) || updated.documents_blocked) {
      const sync = await syncDriverDocumentStatus(updated, {
        notifyPhone: message.phone,
      });

      if (
        hasExpiredDocuments(sync.driver) &&
        !sync.blockedNow &&
        !sync.unblockedNow
      ) {
        await sendTextMessage(message.phone, EXPIRED_DOCS_MESSAGE);
      }
    }

    return true;
  }

  return false;
}

export function isDriverUpdateState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_UPDATE_CATEGORY" ||
    session?.state === "DRIVER_UPDATE_SELECT_FIELD" ||
    session?.state === "DRIVER_UPDATE_VALUE"
  );
}

export async function getActiveUpdateSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverUpdateState(session) ? session : undefined;
}
