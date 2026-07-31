import type { DriverRow } from "@/lib/supabase/drivers";
import {
  findDriverByPhone,
  getDriverDisplayName,
  setDriverAvailability,
} from "@/lib/supabase/drivers";
import { findPassengerByPhone } from "@/lib/supabase/passengers";
import {
  BLOCKED_AVAILABILITY_MESSAGE,
  hasExpiredDocuments,
} from "@/lib/driver-documents";
import { formatDateForDisplay } from "@/lib/driver-profile-fields";
import { syncDriverDocumentStatus } from "@/lib/document-jobs";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import { startDriverUpdate } from "@/lib/driver-update";
import { catalogBody, cms, cmsSync } from "@/lib/bot-cms/copy";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

/**
 * Navegación jerárquica (máx. 3 botones WhatsApp por pantalla).
 *
 * Principal → Disponibilidad · Mi cuenta · Cerrar sesión
 * Mi cuenta → Mi perfil · Referidos · Volver
 */
export const DRIVER_MENU_IDS = {
  TOGGLE_AVAILABILITY: "toggle_disponibilidad",
  SOLICITAR_SERVICIO: "solicitar_servicio",
  /** Nivel 1 → abre Mi cuenta */
  MI_CUENTA: "menu_mi_cuenta",
  /** Compat: mismo destino que MI_CUENTA */
  MENU_CONDUCTOR: "menu_mi_cuenta",
  /** REF-003: referidos (solo dentro de Mi cuenta) */
  REFERIDOS: "menu_referidos",
  /** REF-004: reenviar enlace para copiar */
  REFERIDOS_COPY: "menu_referidos_copy",
  /** REF-004: compartir por WhatsApp */
  REFERIDOS_SHARE: "menu_referidos_share",
  MI_PERFIL: "menu_mi_perfil",
  SOPORTE: "menu_soporte",
  MIS_DATOS: "menu_mis_datos",
  RENDIMIENTO: "menu_rendimiento",
  REPORTAR: "menu_reportar",
  CONTACTAR_ADMIN: "menu_contactar_admin",
  ACTUALIZAR_DATOS: "menu_actualizar_datos",
  VOLVER_PRINCIPAL: "menu_volver_principal",
  VOLVER_CUENTA: "menu_volver_cuenta",
  VOLVER_PERFIL: "menu_volver_perfil",
  LOGOUT: "driver_auth_logout",
} as const;

export type SendDriverMainMenuOptions = {
  /**
   * Saludo completo (¡Hola! / Sesión iniciada / ¿Qué deseas hacer?).
   * Solo inmediatamente después del inicio de sesión o creación de contraseña.
   */
  welcome?: boolean;
  /**
   * Cuerpo CTA (confirmación, cancelación, etc.).
   * Si se define, reemplaza el saludo de bienvenida.
   */
  body?: string;
};

/**
 * Menú principal (sesión iniciada): disponibilidad · Mi cuenta · Cerrar sesión.
 * Sprint 2.1: sin repetir saludo de sesión salvo `welcome: true`.
 * REF-003.1: Referidos vive en Mi cuenta (no en el menú principal).
 */
export async function sendDriverMainMenu(
  driver: DriverRow,
  toPhone?: string,
  options?: SendDriverMainMenuOptions,
) {
  const availabilityButton = driver.is_available
    ? { id: DRIVER_MENU_IDS.TOGGLE_AVAILABILITY, title: "🔴 No disponible" }
    : { id: DRIVER_MENU_IDS.TOGGLE_AVAILABILITY, title: "🟢 Disponible" };

  const statusLabel = driver.documents_blocked
    ? catalogBody("D_MAIN_STATUS_DOCS_BLOCKED")
    : driver.is_available
      ? catalogBody("D_MAIN_STATUS_AVAILABLE")
      : catalogBody("D_MAIN_STATUS_UNAVAILABLE");

  let greetName = getDriverDisplayName(driver);
  if (options?.welcome) {
    const passenger = await findPassengerByPhone(toPhone ?? driver.phone);
    if (passenger?.preferred_name?.trim()) {
      greetName = passenger.preferred_name.trim();
    }
    if (driver.preferred_name?.trim()) {
      greetName = driver.preferred_name.trim();
    }
  }

  const trimmedBody = options?.body?.trim();
  const body = trimmedBody
    ? trimmedBody
    : options?.welcome
      ? cmsSync("D_MAIN_WELCOME", { nombre: greetName })
      : statusLabel;

  await sendButtonsMessage(toPhone ?? driver.phone, body, [
    availabilityButton,
    {
      id: DRIVER_MENU_IDS.MI_CUENTA,
      title: "👤 Mi cuenta",
    },
    {
      id: DRIVER_MENU_IDS.LOGOUT,
      title: "🔒 Cerrar sesión",
    },
  ]);
}

/**
 * Nivel: Mi cuenta.
 *
 * Módulo temporalmente deshabilitado.
 * La funcionalidad de Soporte (Reportar novedad y Contactar administrador)
 * se implementará en un sprint posterior, una vez se defina la estrategia
 * de gestión de tickets y el modelo de costos de mensajería de WhatsApp Cloud API.
 *
 * El código de Soporte (`sendDriverSupportMenu`, handlers, button IDs) se conserva;
 * solo se oculta el acceso desde esta navegación.
 */
export async function sendDriverAccountMenu(phone: string): Promise<void> {
  await sendButtonsMessage(phone, await cms("D_ACCOUNT_MENU"), [
    { id: DRIVER_MENU_IDS.MI_PERFIL, title: "📋 Mi perfil" },
    { id: DRIVER_MENU_IDS.REFERIDOS, title: "👥 Referidos" },
    { id: DRIVER_MENU_IDS.VOLVER_PRINCIPAL, title: "⬅️ Volver" },
  ]);
}

/** Nivel: Mi perfil */
export async function sendDriverProfileMenu(phone: string): Promise<void> {
  await sendButtonsMessage(phone, await cms("D_PROFILE_MENU"), [
    { id: DRIVER_MENU_IDS.MIS_DATOS, title: "👤 Mis datos" },
    { id: DRIVER_MENU_IDS.RENDIMIENTO, title: "📊 Mi rendimiento" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}

/**
 * Nivel: Soporte.
 * Conservado para reactivación futura; no expuesto en Mi cuenta por ahora.
 */
export async function sendDriverSupportMenu(phone: string): Promise<void> {
  await sendButtonsMessage(phone, await cms("D_SUPPORT_MENU"), [
    { id: DRIVER_MENU_IDS.REPORTAR, title: "⚠️ Reportar novedad" },
    { id: DRIVER_MENU_IDS.CONTACTAR_ADMIN, title: "📞 Contactar admin" },
    { id: DRIVER_MENU_IDS.VOLVER_CUENTA, title: "⬅️ Volver" },
  ]);
}

/** @deprecated Usar sendDriverAccountMenu */
export async function sendDriverSubMenu(driverPhone: string) {
  await sendDriverAccountMenu(driverPhone);
}

export async function handleToggleAvailability(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  const nextAvailable = !driver.is_available;

  if (nextAvailable && (driver.documents_blocked || driver.status === "inactive")) {
    await sendExpiredDocumentsPrompt(phone, BLOCKED_AVAILABILITY_MESSAGE);
    return;
  }

  if (
    nextAvailable &&
    driver.suspended_until &&
    new Date(driver.suspended_until).getTime() > Date.now()
  ) {
    const until = new Date(driver.suspended_until).toLocaleString("es-CO");
    await sendTextMessage(
      phone,
      await cms("D_SUSPENDED_UNTIL", { until }),
    );
    return;
  }

  if (nextAvailable && hasExpiredDocuments(driver)) {
    await syncDriverDocumentStatus(driver);
    await sendExpiredDocumentsPrompt(phone, BLOCKED_AVAILABILITY_MESSAGE);
    return;
  }

  const updated = await setDriverAvailability(driver.id, nextAvailable);

  if (!updated) {
    await sendTextMessage(phone, await cms("D_AVAILABILITY_UPDATE_FAIL"));
    return;
  }

  const confirm = nextAvailable
    ? await cms("D_AVAILABILITY_ON")
    : await cms("D_AVAILABILITY_OFF");

  await sendDriverMainMenu(updated, phone, { body: confirm });
}

export async function handleDriverAccountMenu(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  await sendDriverAccountMenu(phone);
}

/** @deprecated Usar handleDriverAccountMenu */
export async function handleDriverSubMenu(phone: string): Promise<void> {
  await handleDriverAccountMenu(phone);
}

export async function handleDriverNavBackToMain(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  await sendDriverMainMenu(driver, phone);
}

export async function handleDriverNavBackToAccount(phone: string): Promise<void> {
  await sendDriverAccountMenu(phone);
}

export async function handleDriverNavBackToProfile(phone: string): Promise<void> {
  await sendDriverProfileMenu(phone);
}

function valueOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
}

export async function handleDriverProfile(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, await cms("D_NOT_REGISTERED"));
    return;
  }

  const availability = driver.is_available ? "Disponible" : "No disponible";
  const accountStatus = driver.status === "inactive" ? "Inactivo" : "Activo";
  const blocked = driver.documents_blocked ? "Sí" : "No";

  await sendButtonsMessage(
    phone,
    cmsSync("D_PROFILE_DATA", {
      full_name: valueOrDash(driver.full_name || driver.name),
      document_id: valueOrDash(driver.document_id),
      email: valueOrDash(driver.email),
      address: valueOrDash(driver.address),
      city: valueOrDash(driver.city),
      phone: valueOrDash(driver.phone),
      plate: valueOrDash(driver.plate),
      brand: valueOrDash(driver.vehicle_brand),
      model: valueOrDash(driver.vehicle_model),
      color: valueOrDash(driver.vehicle_color),
      soat: formatDateForDisplay(driver.soat_expires_at),
      techno: formatDateForDisplay(driver.techno_expires_at),
      operation: formatDateForDisplay(driver.operation_expires_at),
      license: formatDateForDisplay(driver.license_expires_at),
      availability,
      account_status: accountStatus,
      blocked,
    }),
    [
      {
        id: DRIVER_MENU_IDS.ACTUALIZAR_DATOS,
        title: "✏️ Actualizar datos",
      },
      {
        id: DRIVER_MENU_IDS.VOLVER_PERFIL,
        title: "⬅️ Volver",
      },
    ],
  );
}

export async function handleUpdateDriverData(phone: string): Promise<void> {
  await startDriverUpdate(phone);
}

export async function handleDriverReport(phone: string): Promise<void> {
  await sendTextMessage(phone, await cms("D_REPORT_PLACEHOLDER"));
  await sendDriverSupportMenu(phone);
}

export async function handleDriverContactAdmin(phone: string): Promise<void> {
  await sendTextMessage(phone, await cms("D_CONTACT_ADMIN_PLACEHOLDER"));
  await sendDriverSupportMenu(phone);
}

export function isDriverMenuButton(button: string | null): boolean {
  if (!button) {
    return false;
  }

  return (
    button === DRIVER_MENU_IDS.TOGGLE_AVAILABILITY ||
    button === DRIVER_MENU_IDS.MI_CUENTA ||
    button === DRIVER_MENU_IDS.REFERIDOS ||
    button === DRIVER_MENU_IDS.REFERIDOS_COPY ||
    button === DRIVER_MENU_IDS.REFERIDOS_SHARE ||
    button === DRIVER_MENU_IDS.MI_PERFIL ||
    button === DRIVER_MENU_IDS.SOPORTE ||
    button === DRIVER_MENU_IDS.RENDIMIENTO ||
    button === DRIVER_MENU_IDS.MIS_DATOS ||
    button === DRIVER_MENU_IDS.ACTUALIZAR_DATOS ||
    button === DRIVER_MENU_IDS.REPORTAR ||
    button === DRIVER_MENU_IDS.CONTACTAR_ADMIN ||
    button === DRIVER_MENU_IDS.VOLVER_PRINCIPAL ||
    button === DRIVER_MENU_IDS.VOLVER_CUENTA ||
    button === DRIVER_MENU_IDS.VOLVER_PERFIL ||
    button === DRIVER_MENU_IDS.LOGOUT
  );
}
