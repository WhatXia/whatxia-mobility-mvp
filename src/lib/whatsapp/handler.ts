import type { IncomingMessage } from "@/types";
import {
  cancelTripByPhone,
  handleDriverAccept,
  handleDriverEta,
  handleDriverFinalizarViaje,
  handleDriverIniciarViaje,
  handleDriverLlegue,
  handleDriverReject,
  offerTripToDrivers,
  parseDriverButton,
} from "@/lib/dispatch";
import {
  continueDriverRegistration,
  getActiveRegistrationSession,
  startDriverRegistration,
} from "@/lib/driver-registration";
import {
  continueDriverUpdate,
  getActiveUpdateSession,
  handleUpdateCategorySelection,
  UPDATE_CATEGORY_IDS,
} from "@/lib/driver-update";
import {
  ACTUALIZAR_DOCUMENTOS_ID,
  continueExpiredDocumentsUpdate,
  getActiveExpiredDocsSession,
  startExpiredDocumentsUpdate,
} from "@/lib/driver-expired-docs-update";
import {
  DRIVER_MENU_IDS,
  handleDriverPerformance,
  handleDriverProfile,
  handleDriverReport,
  handleDriverSubMenu,
  handleToggleAvailability,
  handleUpdateDriverData,
  sendDriverMainMenu,
} from "@/lib/driver-menu";
import {
  handlePassengerRating,
  parseRatingButton,
} from "@/lib/rating";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  clearSession,
  getSession,
  upsertSession,
} from "@/lib/sessions";
import {
  notifyIfTunnelClosed,
  routeTunnelMessage,
} from "@/lib/tunnels";

export const BUTTON_IDS = {
  SOLICITAR_SERVICIO: "solicitar_servicio",
  CANCELAR: "cancelar",
} as const;

const GREETINGS = new Set(["hola", "buenas", "buenos dias"]);

const DRIVER_INTENTS = new Set([
  "quiero ser conductor",
  "ser conductor",
  "conductor",
]);

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function isGreeting(text: string | null): boolean {
  if (!text) {
    return false;
  }

  return GREETINGS.has(normalizeText(text));
}

function isDriverIntent(text: string | null): boolean {
  if (!text) {
    return false;
  }

  return DRIVER_INTENTS.has(normalizeText(text));
}

async function sendPassengerWelcomeMenu(phone: string) {
  await sendButtonsMessage(phone, "¡Hola! ¿Qué deseas hacer?", [
    { id: BUTTON_IDS.SOLICITAR_SERVICIO, title: "Solicitar servicio" },
    { id: BUTTON_IDS.CANCELAR, title: "❌ Cancelar" },
  ]);
}

async function startPassengerRequest(
  phone: string,
  name: string,
): Promise<void> {
  await findOrCreatePassenger(phone, name);

  await upsertSession(phone, {
    name,
    state: "WAITING_PICKUP",
    pickupNeighborhood: null,
    driverName: null,
  });

  await sendTextMessage(phone, "¿En qué barrio te vamos a recoger?");
}

export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  console.log("[whatsapp] mensaje recibido:", message);

  const ratingButton = parseRatingButton(message.button);

  if (ratingButton) {
    await handlePassengerRating(
      message.phone,
      ratingButton.tripId,
      ratingButton.rating,
    );
    return;
  }

  const driverButton = parseDriverButton(message.button);

  if (driverButton?.action === "accept") {
    await handleDriverAccept(message.phone, driverButton.tripId);
    return;
  }

  if (driverButton?.action === "reject") {
    await handleDriverReject(message.phone, driverButton.tripId);
    return;
  }

  if (driverButton?.action === "eta") {
    await handleDriverEta(
      message.phone,
      driverButton.tripId,
      driverButton.minutes,
    );
    return;
  }

  if (driverButton?.action === "llegue") {
    await handleDriverLlegue(message.phone, driverButton.tripId);
    return;
  }

  if (driverButton?.action === "iniciar") {
    await handleDriverIniciarViaje(message.phone, driverButton.tripId);
    return;
  }

  if (driverButton?.action === "finalizar") {
    await handleDriverFinalizarViaje(message.phone, driverButton.tripId);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.TOGGLE_AVAILABILITY) {
    await handleToggleAvailability(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.MENU_CONDUCTOR) {
    await handleDriverSubMenu(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.RENDIMIENTO) {
    await handleDriverPerformance(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.MIS_DATOS) {
    await handleDriverProfile(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.ACTUALIZAR_DATOS) {
    await handleUpdateDriverData(message.phone);
    return;
  }

  if (message.button === ACTUALIZAR_DOCUMENTOS_ID) {
    await startExpiredDocumentsUpdate(message.phone);
    return;
  }

  if (
    message.button === UPDATE_CATEGORY_IDS.PERSONAL ||
    message.button === UPDATE_CATEGORY_IDS.VEHICLE ||
    message.button === UPDATE_CATEGORY_IDS.DOCUMENTS
  ) {
    await handleUpdateCategorySelection(message.phone, message.button);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.REPORTAR) {
    await handleDriverReport(message.phone);
    return;
  }

  if (message.button === BUTTON_IDS.SOLICITAR_SERVICIO) {
    await startPassengerRequest(message.phone, message.name);
    return;
  }

  if (message.button === BUTTON_IDS.CANCELAR) {
    await clearSession(message.phone);
    const cancelled = await cancelTripByPhone(message.phone);
    if (!cancelled) {
      await sendTextMessage(message.phone, "Operación cancelada.");
    }
    return;
  }

  const session = await getSession(message.phone);

  // Barrio: prioriza solicitud de viaje sobre el túnel.
  if (session?.state === "WAITING_PICKUP" && message.text) {
    const neighborhood = message.text.trim();

    await upsertSession(message.phone, {
      name: message.name,
      state: "SEARCHING_DRIVER",
      pickupNeighborhood: neighborhood,
    });

    console.log("[session] barrio guardado:", {
      phone: message.phone,
      pickupNeighborhood: neighborhood,
    });

    await sendTextMessage(
      message.phone,
      "Estamos buscando un conductor. Un momento por favor.",
    );

    await offerTripToDrivers(message.phone, neighborhood);
    return;
  }

  // Cancelar viaje (texto): cierra el túnel de inmediato y no reenvía el mensaje.
  if (
    message.text &&
    !message.button &&
    normalizeText(message.text) === "cancelar"
  ) {
    await clearSession(message.phone);
    const cancelled = await cancelTripByPhone(message.phone);
    if (cancelled) {
      return;
    }
  }

  // Conversation Tunnel: ANTES del Core Agent y de flujos guiados.
  // Si hay túnel active/closing para este teléfono → enrutar y no continuar.
  if (message.text && !message.button) {
    const tunnelResult = await routeTunnelMessage(
      message.phone,
      message.text,
    );

    console.log("[tunnel:handler]", {
      phone: message.phone,
      found: tunnelResult.found,
      tripId: tunnelResult.tripId,
      status: tunnelResult.status,
      outcome: tunnelResult.outcome,
      reason: tunnelResult.reason,
    });

    if (tunnelResult.outcome === "routed") {
      console.log("[tunnel:handler] enrutado → no pasa al Core Agent", {
        tripId: tunnelResult.tripId,
        status: tunnelResult.status,
      });
      return;
    }

    console.log(
      "[tunnel:handler] sin túnel usable → continúa al Core Agent",
      {
        phone: message.phone,
        found: tunnelResult.found,
        tripId: tunnelResult.tripId,
        status: tunnelResult.status,
        reason: tunnelResult.reason,
      },
    );
  }

  const expiredDocsSession = await getActiveExpiredDocsSession(message.phone);

  if (expiredDocsSession) {
    const handled = await continueExpiredDocumentsUpdate(
      message,
      expiredDocsSession,
    );
    if (handled) {
      return;
    }
  }

  const updateSession = await getActiveUpdateSession(message.phone);

  if (updateSession) {
    const handled = await continueDriverUpdate(message, updateSession);
    if (handled) {
      return;
    }
  }

  const registrationSession = await getActiveRegistrationSession(message.phone);

  if (registrationSession) {
    const handled = await continueDriverRegistration(
      message,
      registrationSession,
    );
    if (handled) {
      return;
    }
  }

  if (isDriverIntent(message.text)) {
    await startDriverRegistration(message.phone);
    return;
  }

  // Core Agent: menú / saludo (solo si no hubo túnel activo).
  if (isGreeting(message.text)) {
    await findOrCreatePassenger(message.phone, message.name);

    await upsertSession(message.phone, {
      name: message.name,
      state: "IDLE",
      pickupNeighborhood: null,
      driverName: null,
      driverDraft: null,
      driverFlowStep: null,
      driverUpdateCategory: null,
      driverUpdateField: null,
    });

    const driver = await findDriverByPhone(message.phone);

    if (driver) {
      await sendDriverMainMenu(driver, message.phone);
      return;
    }

    await sendPassengerWelcomeMenu(message.phone);
    return;
  }

  // Texto no-saludo con túnel cerrado → aviso de canal no disponible.
  if (message.text) {
    const closed = await notifyIfTunnelClosed(message.phone);
    if (closed) {
      return;
    }

    console.log("[core-agent] Escribe Hola para comenzar", {
      phone: message.phone,
    });
    await sendTextMessage(message.phone, "Escribe Hola para comenzar.");
  }
}
