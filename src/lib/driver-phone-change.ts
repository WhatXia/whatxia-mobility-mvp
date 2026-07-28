/**
 * AUTH-WA-002 — Cambio de número WhatsApp del conductor (conversacional).
 * Flujo: documento → contraseña → nuevo número → confirmación en el nuevo WhatsApp.
 */

import type { IncomingMessage, UserSession, DriverDraft } from "@/types";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  findDriverByPhone,
  updateDriverPhone,
  type DriverRow,
} from "@/lib/supabase/drivers";
import {
  clearDriverAuthSession,
  createDriverAuthSession,
} from "@/lib/driver-auth-session";
import { verifyPassword } from "@/lib/driver-password";
import { getSupabase } from "@/lib/supabase/client";
import { normalizePhone, samePhone } from "@/lib/trips";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  evaluatePhoneChangeCooldown,
  formatPhoneChangeAvailableDate,
  getLastPhoneChangeAt,
} from "@/lib/driver-profile-audit";
import { DRIVER_MENU_IDS } from "@/lib/driver-menu";

const RESET_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DOCUMENT_ATTEMPTS = 3;
const MAX_PASSWORD_ATTEMPTS = 3;

const META_STARTED = "__phone_chg_started";
const META_DOC_ATTEMPTS = "__phone_chg_doc_attempts";
const META_PW_ATTEMPTS = "__phone_chg_pw_attempts";
const META_REQUEST_ID = "__phone_chg_request_id";

type DraftMeta = DriverDraft & {
  [META_STARTED]?: string;
  [META_DOC_ATTEMPTS]?: number;
  [META_PW_ATTEMPTS]?: number;
  [META_REQUEST_ID]?: string;
};

export const PHONE_CHANGE_BUTTON_IDS = {
  CONFIRM_PREFIX: "phone_chg_ok:",
  CANCEL_PREFIX: "phone_chg_no:",
} as const;

function getMeta(draft: UserSession["driverDraft"]): DraftMeta {
  return ((draft as DraftMeta | null) ?? {}) as DraftMeta;
}

function withMeta(
  draft: UserSession["driverDraft"],
  patch: Partial<DraftMeta>,
): DraftMeta {
  return { ...getMeta(draft), ...patch };
}

function normalizeDocumentId(raw: string): string {
  return raw.replace(/\D/g, "");
}

function phoneChangeConfirmId(requestId: string) {
  return `${PHONE_CHANGE_BUTTON_IDS.CONFIRM_PREFIX}${requestId}`;
}

function phoneChangeCancelId(requestId: string) {
  return `${PHONE_CHANGE_BUTTON_IDS.CANCEL_PREFIX}${requestId}`;
}

export function parsePhoneChangeButton(
  button: string | null | undefined,
): { action: "confirm" | "cancel"; requestId: string } | null {
  if (!button) return null;
  if (button.startsWith(PHONE_CHANGE_BUTTON_IDS.CONFIRM_PREFIX)) {
    return {
      action: "confirm",
      requestId: button.slice(PHONE_CHANGE_BUTTON_IDS.CONFIRM_PREFIX.length),
    };
  }
  if (button.startsWith(PHONE_CHANGE_BUTTON_IDS.CANCEL_PREFIX)) {
    return {
      action: "cancel",
      requestId: button.slice(PHONE_CHANGE_BUTTON_IDS.CANCEL_PREFIX.length),
    };
  }
  return null;
}

export function isDriverPhoneChangeState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "DRIVER_PHONE_CHANGE_DOCUMENT" ||
    session?.state === "DRIVER_PHONE_CHANGE_PASSWORD" ||
    session?.state === "DRIVER_PHONE_CHANGE_NEW_NUMBER" ||
    session?.state === "DRIVER_PHONE_CHANGE_AWAIT_CONFIRM"
  );
}

export async function getActivePhoneChangeSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isDriverPhoneChangeState(session) ? session : undefined;
}

async function cancelPhoneChangeFlow(
  phone: string,
  reason: string,
): Promise<void> {
  await clearSession(phone);
  await sendTextMessage(phone, reason);
}

export async function startDriverPhoneChange(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  // DRIVER-004.1: máximo un cambio cada 30 días (vía auditoría de phone).
  const lastChangeAt = await getLastPhoneChangeAt(driver.id);
  const cooldown = evaluatePhoneChangeCooldown(lastChangeAt);
  if (!cooldown.allowed) {
    const fecha = formatPhoneChangeAvailableDate(cooldown.nextAvailableAt);
    await sendButtonsMessage(
      phone,
      [
        "⚠️ Solo puedes cambiar tu número de WhatsApp una vez cada 30 días.",
        "",
        `Tu próximo cambio estará disponible el ${fecha}.`,
      ].join("\n"),
      [
        {
          id: DRIVER_MENU_IDS.VOLVER_PRINCIPAL,
          title: "🔙 Volver al menú",
        },
      ],
    );
    console.log("[auth-wa-002] cambio bloqueado por cooldown 30d", {
      phone,
      nextAvailableAt: cooldown.nextAvailableAt.toISOString(),
    });
    return;
  }

  await upsertSession(phone, {
    state: "DRIVER_PHONE_CHANGE_DOCUMENT",
    driverDraft: withMeta(null, {
      [META_STARTED]: new Date().toISOString(),
      [META_DOC_ATTEMPTS]: 0,
      [META_PW_ATTEMPTS]: 0,
    }),
    driverUpdateCategory: null,
    driverUpdateField: null,
    driverFlowStep: null,
    bookingDraft: null,
  });

  await sendTextMessage(
    phone,
    [
      "📱 Cambio de número de WhatsApp",
      "",
      "Para verificar tu identidad necesito tu número de documento registrado en WhatXia.",
    ].join("\n"),
  );

  console.log("[auth-wa-002] inicio cambio de WhatsApp", { phone });
}

async function createPhoneChangeRequest(
  driver: DriverRow,
  oldPhone: string,
  newPhone: string,
): Promise<string> {
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + RESET_TIMEOUT_MS).toISOString();

  // Cancelar pendientes previos del mismo conductor.
  await supabase
    .from("driver_phone_change_requests")
    .update({ status: "cancelled" })
    .eq("driver_id", driver.id)
    .eq("status", "pending");

  const { data, error } = await supabase
    .from("driver_phone_change_requests")
    .insert({
      driver_id: driver.id,
      old_phone: normalizePhone(oldPhone),
      new_phone: normalizePhone(newPhone),
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    console.error("[auth-wa-002] error al crear solicitud:", error);
    throw error ?? new Error("No se pudo crear la solicitud de cambio");
  }

  return data.id as string;
}

async function getPhoneChangeRequest(requestId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("driver_phone_change_requests")
    .select("id, driver_id, old_phone, new_phone, status, expires_at")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    console.error("[auth-wa-002] error al leer solicitud:", error);
    throw error;
  }

  return data as {
    id: string;
    driver_id: string;
    old_phone: string;
    new_phone: string;
    status: string;
    expires_at: string;
  } | null;
}

async function setPhoneChangeStatus(
  requestId: string,
  status: "confirmed" | "cancelled" | "expired",
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("driver_phone_change_requests")
    .update({ status })
    .eq("id", requestId);
}

async function migrateActiveTripPhones(
  driverId: string,
  newPhone: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("trips")
    .update({ driver_phone: normalizePhone(newPhone) })
    .eq("driver_id", driverId)
    .in("status", [
      "SEARCHING",
      "ASSIGNED",
      "ETA_INFORMED",
      "DRIVER_ARRIVED",
      "IN_PROGRESS",
    ]);

  if (error) {
    console.error("[auth-wa-002] error al migrar trips.driver_phone:", error);
  }
}

async function applyConfirmedPhoneChange(request: {
  id: string;
  driver_id: string;
  old_phone: string;
  new_phone: string;
}): Promise<DriverRow | null> {
  const updated = await updateDriverPhone(request.driver_id, request.new_phone);
  if (!updated) return null;

  await migrateActiveTripPhones(request.driver_id, request.new_phone);

  await clearDriverAuthSession(request.old_phone);
  await createDriverAuthSession(request.new_phone, request.driver_id);

  await clearSession(request.old_phone);
  await clearSession(request.new_phone);

  await setPhoneChangeStatus(request.id, "confirmed");
  return updated;
}

export async function continueDriverPhoneChange(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isDriverPhoneChangeState(session)) {
    return false;
  }

  const meta = getMeta(session.driverDraft);
  const startedAt = meta[META_STARTED]
    ? Date.parse(String(meta[META_STARTED]))
    : NaN;

  if (Number.isFinite(startedAt) && Date.now() - startedAt > RESET_TIMEOUT_MS) {
    const requestId = meta[META_REQUEST_ID];
    if (typeof requestId === "string") {
      await setPhoneChangeStatus(requestId, "expired");
    }
    await cancelPhoneChangeFlow(
      message.phone,
      "⏱️ Se agotó el tiempo para cambiar el número (10 minutos sin respuesta). Inténtalo de nuevo.",
    );
    return true;
  }

  const touch = () =>
    withMeta(session.driverDraft, {
      [META_STARTED]: new Date().toISOString(),
    });

  const intent = message.text?.trim() ?? "";
  if (intent === "🚖" || intent === "🚕") {
    await clearSession(message.phone);
    await sendTextMessage(message.phone, "Cambio de número cancelado.");
    return true;
  }

  if (session.state === "DRIVER_PHONE_CHANGE_DOCUMENT") {
    if (!message.text?.trim()) {
      await upsertSession(message.phone, {
        state: "DRIVER_PHONE_CHANGE_DOCUMENT",
        driverDraft: touch(),
      });
      await sendTextMessage(
        message.phone,
        "Para verificar tu identidad necesito tu número de documento registrado en WhatXia.",
      );
      return true;
    }

    const driver = await findDriverByPhone(message.phone);
    const doc = normalizeDocumentId(message.text);
    const registered = normalizeDocumentId(driver?.document_id ?? "");
    const matches =
      Boolean(driver) && doc.length > 0 && registered.length > 0 && doc === registered;

    if (!matches) {
      const attempts = (Number(meta[META_DOC_ATTEMPTS]) || 0) + 1;
      if (attempts >= MAX_DOCUMENT_ATTEMPTS) {
        await cancelPhoneChangeFlow(
          message.phone,
          "Has superado el máximo de intentos de verificación. El cambio de número fue cancelado.",
        );
        return true;
      }
      await upsertSession(message.phone, {
        state: "DRIVER_PHONE_CHANGE_DOCUMENT",
        driverDraft: withMeta(touch(), { [META_DOC_ATTEMPTS]: attempts }),
      });
      await sendTextMessage(
        message.phone,
        "El documento no coincide con el registrado en tu cuenta. Inténtalo nuevamente.",
      );
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_PHONE_CHANGE_PASSWORD",
      driverDraft: withMeta(touch(), { [META_DOC_ATTEMPTS]: 0 }),
    });
    await sendTextMessage(message.phone, "Escribe tu contraseña actual.");
    return true;
  }

  if (session.state === "DRIVER_PHONE_CHANGE_PASSWORD") {
    if (!message.text) {
      await sendTextMessage(message.phone, "Escribe tu contraseña actual.");
      return true;
    }

    const driver = await findDriverByPhone(message.phone);
    if (!driver?.password_hash) {
      await cancelPhoneChangeFlow(
        message.phone,
        "No encontramos una contraseña configurada. Restablécela e intenta de nuevo.",
      );
      return true;
    }

    const ok = await verifyPassword(message.text, driver.password_hash);
    if (!ok) {
      const attempts = (Number(meta[META_PW_ATTEMPTS]) || 0) + 1;
      if (attempts >= MAX_PASSWORD_ATTEMPTS) {
        await cancelPhoneChangeFlow(
          message.phone,
          "Has superado el máximo de intentos de contraseña. El cambio de número fue cancelado.",
        );
        return true;
      }
      await upsertSession(message.phone, {
        state: "DRIVER_PHONE_CHANGE_PASSWORD",
        driverDraft: withMeta(touch(), { [META_PW_ATTEMPTS]: attempts }),
      });
      await sendTextMessage(
        message.phone,
        `❌ Contraseña incorrecta. Intento ${attempts} de ${MAX_PASSWORD_ATTEMPTS}.`,
      );
      return true;
    }

    await upsertSession(message.phone, {
      state: "DRIVER_PHONE_CHANGE_NEW_NUMBER",
      driverDraft: withMeta(touch(), { [META_PW_ATTEMPTS]: 0 }),
    });
    await sendTextMessage(
      message.phone,
      "Escribe tu nuevo número de WhatsApp (con indicativo de país, ejemplo: 573001234567).",
    );
    return true;
  }

  if (session.state === "DRIVER_PHONE_CHANGE_NEW_NUMBER") {
    if (!message.text?.trim()) {
      await sendTextMessage(
        message.phone,
        "Escribe tu nuevo número de WhatsApp (con indicativo de país).",
      );
      return true;
    }

    const newPhone = normalizePhone(message.text);
    if (newPhone.length < 10) {
      await sendTextMessage(
        message.phone,
        "Número inválido. Incluye indicativo y número (mínimo 10 dígitos).",
      );
      return true;
    }

    if (samePhone(newPhone, message.phone)) {
      await sendTextMessage(
        message.phone,
        "El nuevo número debe ser distinto al actual.",
      );
      return true;
    }

    const existing = await findDriverByPhone(newPhone);
    if (existing) {
      await sendTextMessage(
        message.phone,
        "Ese número ya está registrado en otra cuenta de conductor. Usa otro WhatsApp.",
      );
      return true;
    }

    const driver = await findDriverByPhone(message.phone);
    if (!driver) {
      await cancelPhoneChangeFlow(
        message.phone,
        "No encontramos tu registro de conductor.",
      );
      return true;
    }

    const requestId = await createPhoneChangeRequest(
      driver,
      message.phone,
      newPhone,
    );

    await upsertSession(message.phone, {
      state: "DRIVER_PHONE_CHANGE_AWAIT_CONFIRM",
      driverDraft: withMeta(touch(), { [META_REQUEST_ID]: requestId }),
    });

    await sendButtonsMessage(
      newPhone,
      [
        "📱 Confirmación de cambio de WhatsApp — WhatXia",
        "",
        `El conductor ${driver.full_name || driver.name} solicitó asociar este número a su cuenta.`,
        "",
        "Si fuiste tú, confirma el cambio.",
      ].join("\n"),
      [
        { id: phoneChangeConfirmId(requestId), title: "✅ Confirmar" },
        { id: phoneChangeCancelId(requestId), title: "❌ Cancelar" },
      ],
    );

    await sendTextMessage(
      message.phone,
      [
        "Enviamos una confirmación a tu nuevo WhatsApp.",
        "",
        "Ábrelo y presiona ✅ Confirmar para completar el cambio.",
      ].join("\n"),
    );

    console.log("[auth-wa-002] pendiente confirmación en nuevo número", {
      phone: message.phone,
      newPhone,
      requestId,
    });
    return true;
  }

  // AWAIT_CONFIRM
  await upsertSession(message.phone, {
    state: "DRIVER_PHONE_CHANGE_AWAIT_CONFIRM",
    driverDraft: touch(),
  });
  await sendTextMessage(
    message.phone,
    "Aún estamos esperando la confirmación desde tu nuevo WhatsApp. Ábrelo y presiona ✅ Confirmar.",
  );
  return true;
}

export async function handlePhoneChangeConfirmButton(
  phone: string,
  action: "confirm" | "cancel",
  requestId: string,
): Promise<void> {
  const request = await getPhoneChangeRequest(requestId);
  if (!request) {
    await sendTextMessage(
      phone,
      "No encontramos la solicitud de cambio de número.",
    );
    return;
  }

  if (request.status !== "pending") {
    await sendTextMessage(
      phone,
      "Esta solicitud ya no está pendiente.",
    );
    return;
  }

  if (Date.parse(request.expires_at) < Date.now()) {
    await setPhoneChangeStatus(requestId, "expired");
    await sendTextMessage(
      phone,
      "La solicitud expiró. Inicia el cambio de número nuevamente desde Mis datos.",
    );
    await clearSession(request.old_phone);
    return;
  }

  if (!samePhone(phone, request.new_phone)) {
    await sendTextMessage(
      phone,
      "Esta confirmación solo puede hacerse desde el nuevo número de WhatsApp.",
    );
    return;
  }

  if (action === "cancel") {
    await setPhoneChangeStatus(requestId, "cancelled");
    await clearSession(request.old_phone);
    await sendTextMessage(phone, "Cambio de número cancelado.");
    await sendTextMessage(
      request.old_phone,
      "El cambio de número fue cancelado desde el nuevo WhatsApp.",
    );
    return;
  }

  const stillTaken = await findDriverByPhone(request.new_phone);
  if (stillTaken && stillTaken.id !== request.driver_id) {
    await setPhoneChangeStatus(requestId, "cancelled");
    await sendTextMessage(
      phone,
      "Ese número ya está en uso. El cambio fue cancelado.",
    );
    return;
  }

  const updated = await applyConfirmedPhoneChange(request);
  if (!updated) {
    await sendTextMessage(
      phone,
      "No se pudo actualizar el número. Intenta de nuevo más tarde.",
    );
    return;
  }

  await sendTextMessage(
    request.old_phone,
    "✅ Tu número de WhatsApp fue actualizado. Continúa desde el nuevo número.",
  );

  await sendTextMessage(
    request.new_phone,
    [
      "✅ Tu número de WhatsApp fue actualizado correctamente.",
      "",
      "Ya puedes usar WhatXia desde este teléfono.",
    ].join("\n"),
  );

  const { sendPostUpdateMenu } = await import("@/lib/driver-update");
  await sendPostUpdateMenu(request.new_phone);

  console.log("[auth-wa-002] teléfono actualizado", {
    driverId: request.driver_id,
    oldPhone: request.old_phone,
    newPhone: request.new_phone,
  });
}
