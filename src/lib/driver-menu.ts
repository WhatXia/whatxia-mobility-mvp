import type { DriverRow } from "@/lib/supabase/drivers";
import {
  findDriverByPhone,
  setDriverAvailability,
} from "@/lib/supabase/drivers";
import {
  BLOCKED_AVAILABILITY_MESSAGE,
  hasExpiredDocuments,
} from "@/lib/driver-documents";
import { formatDateForDisplay } from "@/lib/driver-profile-fields";
import { syncDriverDocumentStatus } from "@/lib/document-jobs";
import { sendExpiredDocumentsPrompt } from "@/lib/expired-docs-prompt";
import { startDriverUpdate } from "@/lib/driver-update";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

export const DRIVER_MENU_IDS = {
  TOGGLE_AVAILABILITY: "toggle_disponibilidad",
  SOLICITAR_SERVICIO: "solicitar_servicio",
  MENU_CONDUCTOR: "menu_conductor",
  RENDIMIENTO: "menu_rendimiento",
  MIS_DATOS: "menu_mis_datos",
  ACTUALIZAR_DATOS: "menu_actualizar_datos",
  REPORTAR: "menu_reportar",
} as const;

export async function sendDriverMainMenu(
  driver: DriverRow,
  toPhone?: string,
) {
  const availabilityButton = driver.is_available
    ? { id: DRIVER_MENU_IDS.TOGGLE_AVAILABILITY, title: "🔴 No disponible" }
    : { id: DRIVER_MENU_IDS.TOGGLE_AVAILABILITY, title: "🟢 Disponible" };

  const statusLabel = driver.documents_blocked
    ? "⛔ Bloqueado por documentos vencidos"
    : driver.is_available
      ? "🟢 Disponible para recibir servicios"
      : "🔴 No disponible para recibir servicios";

  await sendButtonsMessage(
    toPhone ?? driver.phone,
    `¡Hola ${driver.name}!\n\n${statusLabel}\n\n¿Qué deseas hacer?`,
    [
      availabilityButton,
      {
        id: DRIVER_MENU_IDS.SOLICITAR_SERVICIO,
        title: "🚖 Solicitar",
      },
      {
        id: DRIVER_MENU_IDS.MENU_CONDUCTOR,
        title: "🚗 Menú conductor",
      },
    ],
  );
}

export async function sendDriverSubMenu(driverPhone: string) {
  await sendButtonsMessage(driverPhone, "Menú del conductor:", [
    { id: DRIVER_MENU_IDS.RENDIMIENTO, title: "📊 Mi rendimiento" },
    { id: DRIVER_MENU_IDS.MIS_DATOS, title: "👤 Mis datos" },
    { id: DRIVER_MENU_IDS.REPORTAR, title: "⚠️ Reportar novedad" },
  ]);
}

export async function handleToggleAvailability(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  const nextAvailable = !driver.is_available;

  if (nextAvailable && (driver.documents_blocked || driver.status === "inactive")) {
    await sendExpiredDocumentsPrompt(phone, BLOCKED_AVAILABILITY_MESSAGE);
    return;
  }

  if (nextAvailable && hasExpiredDocuments(driver)) {
    await syncDriverDocumentStatus(driver);
    await sendExpiredDocumentsPrompt(phone, BLOCKED_AVAILABILITY_MESSAGE);
    return;
  }

  const updated = await setDriverAvailability(driver.id, nextAvailable);

  if (!updated) {
    await sendTextMessage(phone, "No se pudo actualizar tu disponibilidad.");
    return;
  }

  const confirm = nextAvailable
    ? "✅ Ahora estás disponible para recibir servicios."
    : "✅ Ahora no estás disponible para recibir servicios.";

  await sendTextMessage(phone, confirm);
  await sendDriverMainMenu(updated, phone);
}

export async function handleDriverSubMenu(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);

  if (!driver) {
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  await sendDriverSubMenu(phone);
}

export async function handleDriverPerformance(phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    "📊 Mi rendimiento\n\nPronto podrás ver aquí tus viajes, calificaciones y estadísticas.",
  );
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
    await sendTextMessage(phone, "No encontramos tu registro de conductor.");
    return;
  }

  const availability = driver.is_available ? "Disponible" : "No disponible";
  const accountStatus = driver.status === "inactive" ? "Inactivo" : "Activo";
  const blocked = driver.documents_blocked ? "Sí" : "No";

  await sendButtonsMessage(
    phone,
    [
      "👤 Mis datos",
      "",
      "— Personales —",
      `Nombre: ${valueOrDash(driver.name)}`,
      `Cédula: ${valueOrDash(driver.document_id)}`,
      `Dirección: ${valueOrDash(driver.address)}`,
      `Ciudad: ${valueOrDash(driver.city)}`,
      `Teléfono: ${valueOrDash(driver.phone)}`,
      `Emergencia: ${valueOrDash(driver.emergency_contact_name)} (${valueOrDash(driver.emergency_contact_phone)})`,
      "",
      "— Vehículo —",
      `Placa: ${valueOrDash(driver.plate)}`,
      `Marca: ${valueOrDash(driver.vehicle_brand)}`,
      `Modelo: ${valueOrDash(driver.vehicle_model)}`,
      `Color: ${valueOrDash(driver.vehicle_color)}`,
      `Año: ${valueOrDash(driver.vehicle_year)}`,
      "",
      "— Documentos —",
      `SOAT: ${formatDateForDisplay(driver.soat_expires_at)}`,
      `Tecnomecánica: ${formatDateForDisplay(driver.techno_expires_at)}`,
      `Licencia: ${formatDateForDisplay(driver.license_expires_at)}`,
      "",
      `Disponibilidad: ${availability}`,
      `Cuenta: ${accountStatus}`,
      `Bloqueo docs: ${blocked}`,
    ].join("\n"),
    [
      {
        id: DRIVER_MENU_IDS.ACTUALIZAR_DATOS,
        title: "✏️ Actualizar datos",
      },
    ],
  );
}

export async function handleUpdateDriverData(phone: string): Promise<void> {
  await startDriverUpdate(phone);
}

export async function handleDriverReport(phone: string): Promise<void> {
  await sendTextMessage(
    phone,
    "⚠️ Reportar una novedad\n\nPronto podrás reportar incidencias desde aquí.",
  );
}

export function isDriverMenuButton(button: string | null): boolean {
  if (!button) {
    return false;
  }

  return (
    button === DRIVER_MENU_IDS.TOGGLE_AVAILABILITY ||
    button === DRIVER_MENU_IDS.MENU_CONDUCTOR ||
    button === DRIVER_MENU_IDS.RENDIMIENTO ||
    button === DRIVER_MENU_IDS.MIS_DATOS ||
    button === DRIVER_MENU_IDS.ACTUALIZAR_DATOS ||
    button === DRIVER_MENU_IDS.REPORTAR
  );
}
