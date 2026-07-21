import type { IncomingMessage, UserSession } from "@/types";
import {
  DOCUMENT_FIELDS,
  DOCUMENT_LABELS,
  EXPIRED_DOCS_MESSAGE,
  getExpiredDocuments,
  type DocumentType,
} from "@/lib/driver-documents";
import {
  DRIVER_FIELDS,
  validateDriverField,
  type DriverFieldKey,
} from "@/lib/driver-profile-fields";
import { syncDriverDocumentStatus } from "@/lib/document-jobs";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  findDriverByPhone,
  updateDriverField,
} from "@/lib/supabase/drivers";
import { sendTextMessage } from "@/lib/whatsapp/client";

export { ACTUALIZAR_DOCUMENTOS_ID } from "@/lib/expired-docs-prompt";

const DOC_FIELD_SET = new Set<string>(Object.values(DOCUMENT_FIELDS));

function isDocField(value: string | null): value is DriverFieldKey {
  return Boolean(value && DOC_FIELD_SET.has(value));
}

function queueToString(fields: DriverFieldKey[]): string {
  return fields.join("|");
}

function parseQueue(raw: string | null): DriverFieldKey[] {
  if (!raw) {
    return [];
  }

  return raw
    .split("|")
    .map((item) => item.trim())
    .filter((item): item is DriverFieldKey => isDocField(item));
}

function expiredTypesToFields(expired: DocumentType[]): DriverFieldKey[] {
  return expired.map((type) => DOCUMENT_FIELDS[type]);
}

export async function startExpiredDocumentsUpdate(
  phone: string,
): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  const expired = getExpiredDocuments(driver);

  if (expired.length === 0) {
    const sync = await syncDriverDocumentStatus(driver, {
      notifyPhone: phone,
    });

    if (!sync.driver.documents_blocked) {
      await sendTextMessage(
        phone,
        "✅ Tus documentos ya están vigentes. Cuando quieras, actívate como Disponible desde tu menú.",
      );
    }
    return;
  }

  const fields = expiredTypesToFields(expired);
  const labels = expired.map((type) => DOCUMENT_LABELS[type]).join(", ");
  const [first, ...rest] = fields;

  await upsertSession(phone, {
    state: "DRIVER_UPDATE_EXPIRED_DOCS",
    driverUpdateCategory: "documents",
    driverUpdateField: queueToString(rest),
    driverFlowStep: first,
    driverDraft: null,
  });

  await sendTextMessage(
    phone,
    `Vamos a actualizar solo los documentos vencidos: ${labels}.`,
  );
  await sendTextMessage(phone, DRIVER_FIELDS[first].prompt);
}

export async function continueExpiredDocumentsUpdate(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!message.text || session.state !== "DRIVER_UPDATE_EXPIRED_DOCS") {
    return false;
  }

  const current = session.driverFlowStep;
  if (!isDocField(current)) {
    await clearSession(message.phone);
    await sendTextMessage(
      message.phone,
      "La actualización se interrumpió. Usa el botón 📄 Actualizar docs para continuar.",
    );
    return true;
  }

  const parsed = validateDriverField(current, message.text);
  if (!parsed.ok) {
    await sendTextMessage(message.phone, parsed.error);
    await sendTextMessage(message.phone, DRIVER_FIELDS[current].prompt);
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

  const updated = await updateDriverField(driver.id, current, parsed.value);
  if (!updated) {
    await sendTextMessage(
      message.phone,
      "No se pudo guardar el cambio. Intenta de nuevo.",
    );
    return true;
  }

  await sendTextMessage(
    message.phone,
    `✅ ${DRIVER_FIELDS[current].label} actualizado.`,
  );

  const remaining = parseQueue(session.driverUpdateField);

  if (remaining.length > 0) {
    const [next, ...rest] = remaining;

    await upsertSession(message.phone, {
      state: "DRIVER_UPDATE_EXPIRED_DOCS",
      driverFlowStep: next,
      driverUpdateField: queueToString(rest),
      driverUpdateCategory: "documents",
    });

    await sendTextMessage(message.phone, DRIVER_FIELDS[next].prompt);
    return true;
  }

  await clearSession(message.phone);

  // Releer y sincronizar: si ya no hay vencidos → desbloquea (sin Disponible).
  const refreshed = (await findDriverByPhone(message.phone)) ?? updated;
  const sync = await syncDriverDocumentStatus(refreshed, {
    notifyPhone: message.phone,
  });

  if (sync.unblockedNow) {
    return true;
  }

  if (hasExpiredDocumentsLeft(sync.driver)) {
    await sendExpiredDocumentsPrompt(
      message.phone,
      EXPIRED_DOCS_MESSAGE,
    );
    return true;
  }

  await sendTextMessage(
    message.phone,
    "✅ Documentos actualizados. Cuando quieras recibir servicios, actívate como Disponible.",
  );
  return true;
}

function hasExpiredDocumentsLeft(
  driver: Parameters<typeof getExpiredDocuments>[0],
): boolean {
  return getExpiredDocuments(driver).length > 0;
}

export function isExpiredDocsUpdateState(
  session: UserSession | undefined,
): boolean {
  return session?.state === "DRIVER_UPDATE_EXPIRED_DOCS";
}

export async function getActiveExpiredDocsSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isExpiredDocsUpdateState(session) ? session : undefined;
}
