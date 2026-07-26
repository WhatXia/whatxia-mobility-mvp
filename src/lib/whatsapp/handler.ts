import type { IncomingMessage } from "@/types";
import {
  cancelTripAsDriver,
  cancelTripAsPassenger,
  cancelTripByPhone,
  handlePassengerYaVoy,
  parseCancelCausalButton,
  parseCancelServicioButton,
  parseYaVoyButton,
  sendDriverCancelCausalMenu,
} from "@/lib/cancellations";
import {
  handleSearchCancel,
  handleSearchContinue,
  parseSearchCancelButton,
  parseSearchContinueButton,
  processDueSearchTimeouts,
} from "@/lib/search";
import {
  handleDriverAccept,
  handleDriverEta,
  handleDriverFinalizarViaje,
  handleDriverIniciarViaje,
  handleDriverLlegue,
  handleDriverNavegarDestino,
  handleDriverReject,
  handleDriverVerUbicacion,
  parseDriverButton,
} from "@/lib/dispatch";
import {
  handleBookingMessage,
  isBookingState,
  startBookingFromIntent,
  BOOKING_BUTTON_IDS,
} from "@/lib/booking/flow";
import {
  parseMobilityIntent,
  type MobilityIntentResult,
} from "@/lib/booking/intent";
import {
  continueDriverRegistration,
  getActiveRegistrationSession,
  handleDriverRegistrationButton,
  isDriverRegistrationButton,
  startDriverRegistration,
} from "@/lib/driver-registration";
import {
  continueDriverLogin,
  continueDriverPasswordSetup,
  getActiveLoginSession,
  getActivePasswordSetupSession,
  handleDriverAuthButton,
  isDriverAuthButton,
  requireDriverAuthenticated,
  routeAuthenticatedDriverEntry,
} from "@/lib/driver-auth";
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
  handleDriverAccountMenu,
  handleDriverContactAdmin,
  handleDriverNavBackToAccount,
  handleDriverNavBackToMain,
  handleDriverNavBackToProfile,
  handleDriverPerformance,
  handleDriverProfile,
  handleDriverReport,
  handleToggleAvailability,
  handleUpdateDriverData,
  sendDriverMainMenu,
  sendDriverProfileMenu,
  sendDriverSupportMenu,
} from "@/lib/driver-menu";
import {
  handlePassengerRating,
  handlePostRatingChoice,
  parsePostRatingButton,
  parseRatingButton,
} from "@/lib/rating";
import {
  handleTaximeterMessage,
  isTaximeterButton,
  getTaximeterSession,
} from "@/lib/taximeter-test";
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
import { getTrip, samePhone } from "@/lib/trips";

export const BUTTON_IDS = {
  SOLICITAR_SERVICIO: "solicitar_servicio",
  CANCELAR: "cancelar",
} as const;

const GREETINGS = new Set(["hola", "buenas", "buenos dias"]);

/** Frases exactas (tras normalizar) que abren el módulo conductor. */
const DRIVER_INTENT_EXACT = new Set([
  "quiero ser conductor",
  "ser conductor",
  "conductor",
  "soy conductor",
  "trabajar como conductor",
  "trabajo como conductor",
  "modo conductor",
  "menu conductor",
  "menu del conductor",
  "modulo conductor",
]);

/** Intenciones equivalentes (texto normalizado). */
const DRIVER_INTENT_PATTERNS: RegExp[] = [
  /\b(quiero|deseo|me gustaria)\s+(ser|hacerme)\s+conductor\b/,
  /\b(soy|trabajo como|trabajar como)\s+conductor\b/,
  /\b(registrarme|inscribirme|registro)\s+(como\s+)?conductor\b/,
  /\b(modo|menu|modulo)\s+(de\s+|del\s+)?conductor\b/,
  /\bhacerme\s+conductor\b/,
];

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

/**
 * Intención de entrar al módulo conductor (emoji o frase).
 * No cubre booking de pasajero (“necesito un taxi”, etc.).
 */
export function isDriverIntent(text: string | null): boolean {
  if (!text) {
    return false;
  }

  const trimmed = text.trim();
  if (trimmed === "🚖" || trimmed === "🚕") {
    return true;
  }

  const normalized = normalizeText(trimmed);
  if (!normalized) {
    return false;
  }

  if (DRIVER_INTENT_EXACT.has(normalized)) {
    return true;
  }

  return DRIVER_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Conductor existente → menú. Si no existe → inscripción (sin duplicar).
 */
async function routeDriverModuleEntry(phone: string): Promise<void> {
  const driver = await findDriverByPhone(phone);
  if (driver) {
    await routeAuthenticatedDriverEntry(phone, driver);
    console.log("[core-agent] módulo conductor → auth/menú", { phone });
    return;
  }

  await startDriverRegistration(phone);
  console.log("[core-agent] módulo conductor → inscripción", { phone });
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
  intent: MobilityIntentResult | null = null,
): Promise<void> {
  await findOrCreatePassenger(phone, name);
  await startBookingFromIntent(phone, name, {
    pickupText: intent?.pickupText ?? null,
    destinationText: intent?.destinationText ?? null,
  });
}

export async function handleIncomingMessage(
  message: IncomingMessage,
): Promise<void> {
  console.log("[whatsapp] mensaje recibido:", message);

  try {
    await processDueSearchTimeouts();
  } catch (error) {
    console.error("[search] processDueSearchTimeouts:", error);
  }

  const ratingButton = parseRatingButton(message.button);

  if (ratingButton) {
    await handlePassengerRating(
      message.phone,
      ratingButton.tripId,
      ratingButton.rating,
    );
    return;
  }

  const postRatingButton = parsePostRatingButton(message.button);

  if (postRatingButton) {
    await handlePostRatingChoice(
      message.phone,
      message.name,
      postRatingButton.action,
      postRatingButton.tripId,
    );
    return;
  }

  const cancelServicio = parseCancelServicioButton(message.button);

  if (cancelServicio) {
    const trip = await getTrip(cancelServicio.tripId);

    if (trip && samePhone(message.phone, trip.passengerPhone)) {
      await cancelTripAsPassenger(message.phone, cancelServicio.tripId);
      return;
    }

    await sendDriverCancelCausalMenu(message.phone, cancelServicio.tripId);
    return;
  }

  const cancelCausal = parseCancelCausalButton(message.button);

  if (cancelCausal) {
    await cancelTripAsDriver(
      message.phone,
      cancelCausal.tripId,
      cancelCausal.causal,
    );
    return;
  }

  const yaVoy = parseYaVoyButton(message.button);

  if (yaVoy) {
    await handlePassengerYaVoy(message.phone, yaVoy.tripId);
    return;
  }

  const searchContinue = parseSearchContinueButton(message.button);

  if (searchContinue) {
    await handleSearchContinue(message.phone, searchContinue.tripId);
    return;
  }

  const searchCancel = parseSearchCancelButton(message.button);

  if (searchCancel) {
    await handleSearchCancel(message.phone, searchCancel.tripId);
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

  if (driverButton?.action === "ver_ubicacion") {
    await handleDriverVerUbicacion(message.phone, driverButton.tripId);
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

  if (driverButton?.action === "navegar") {
    await handleDriverNavegarDestino(message.phone, driverButton.tripId);
    return;
  }

  if (driverButton?.action === "finalizar") {
    await handleDriverFinalizarViaje(message.phone, driverButton.tripId);
    return;
  }

  // Auth: Iniciar sesión / Olvidé contraseña / Cerrar sesión
  if (isDriverAuthButton(message.button)) {
    await handleDriverAuthButton(message.phone, message.button);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.TOGGLE_AVAILABILITY) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleToggleAvailability(message.phone);
    return;
  }

  // Navegación jerárquica (máx. 3 botones): Mi cuenta → Perfil | Soporte
  if (message.button === DRIVER_MENU_IDS.MI_CUENTA) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverAccountMenu(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.MI_PERFIL) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await sendDriverProfileMenu(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.SOPORTE) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await sendDriverSupportMenu(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.VOLVER_PRINCIPAL) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverNavBackToMain(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.VOLVER_CUENTA) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverNavBackToAccount(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.VOLVER_PERFIL) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverNavBackToProfile(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.RENDIMIENTO) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverPerformance(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.MIS_DATOS) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverProfile(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.ACTUALIZAR_DATOS) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleUpdateDriverData(message.phone);
    return;
  }

  if (message.button === ACTUALIZAR_DOCUMENTOS_ID) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await startExpiredDocumentsUpdate(message.phone);
    return;
  }

  if (
    message.button === UPDATE_CATEGORY_IDS.PERSONAL ||
    message.button === UPDATE_CATEGORY_IDS.VEHICLE ||
    message.button === UPDATE_CATEGORY_IDS.DOCUMENTS
  ) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleUpdateCategorySelection(message.phone, message.button);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.REPORTAR) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverReport(message.phone);
    return;
  }

  if (message.button === DRIVER_MENU_IDS.CONTACTAR_ADMIN) {
    if (!(await requireDriverAuthenticated(message.phone))) {
      return;
    }
    await handleDriverContactAdmin(message.phone);
    return;
  }

  // Inscripción conductor: Cancelar / Salir / Continuar / Empezar de nuevo
  if (isDriverRegistrationButton(message.button)) {
    await handleDriverRegistrationButton(message.phone, message.button);
    return;
  }

  // Taxímetro de prueba: sesión activa o botones (🚖/🚕 abren módulo conductor).
  if (
    isTaximeterButton(message.button) ||
    (await getTaximeterSession(message.phone))
  ) {
    const handled = await handleTaximeterMessage(message);
    if (handled) {
      return;
    }
  }

  if (message.button === BUTTON_IDS.SOLICITAR_SERVICIO) {
    await startPassengerRequest(message.phone, message.name);
    return;
  }

  if (
    message.button === BOOKING_BUTTON_IDS.REQUEST_TRIP ||
    message.button === BOOKING_BUTTON_IDS.CANCEL_QUOTE ||
    message.button === BOOKING_BUTTON_IDS.CONFIRM_PLACE ||
    message.button === BOOKING_BUTTON_IDS.REJECT_PLACE ||
    message.button === BOOKING_BUTTON_IDS.SHARE_HINT ||
    message.button === BOOKING_BUTTON_IDS.SHARE_DROPOFF_LOCATION ||
    message.button === BOOKING_BUTTON_IDS.RETRY_DROPOFF_TEXT ||
    message.button?.startsWith(BOOKING_BUTTON_IDS.CANDIDATE_PREFIX)
  ) {
    const bookingSession = await getSession(message.phone);
    if (bookingSession && isBookingState(bookingSession.state)) {
      const handled = await handleBookingMessage(message, bookingSession);
      if (handled) {
        return;
      }
    }
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

  // Booking geo/tarifa (texto, ubicación o confirmaciones).
  if (session && isBookingState(session.state)) {
    const handled = await handleBookingMessage(message, session);
    if (handled) {
      return;
    }
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

    // Reasignación / búsqueda en curso: no caer al Core Agent.
    if (session?.state === "SEARCHING_DRIVER") {
      await sendTextMessage(
        message.phone,
        "Seguimos buscando un conductor para ti. Un momento, por favor.",
      );
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

  const passwordSetupSession = await getActivePasswordSetupSession(
    message.phone,
  );

  if (passwordSetupSession) {
    const handled = await continueDriverPasswordSetup(
      message,
      passwordSetupSession,
    );
    if (handled) {
      return;
    }
  }

  const loginSession = await getActiveLoginSession(message.phone);

  if (loginSession) {
    const handled = await continueDriverLogin(message, loginSession);
    if (handled) {
      return;
    }
  }

  if (isDriverIntent(message.text)) {
    await routeDriverModuleEntry(message.phone);
    return;
  }

  // Core Agent: menú / saludo (solo si no hubo túnel activo).
  if (isGreeting(message.text)) {
    await findOrCreatePassenger(message.phone, message.name);

    const driver = await findDriverByPhone(message.phone);

    if (driver) {
      await routeAuthenticatedDriverEntry(message.phone, driver);
      return;
    }

    // No borrar inscripción pausada / setup de contraseña.
    const pendingReg = await getSession(message.phone);
    if (
      pendingReg?.state === "DRIVER_REGISTRATION_WELCOME" ||
      pendingReg?.state === "DRIVER_REGISTRATION_PAUSED" ||
      pendingReg?.state === "DRIVER_REGISTRATION_RESUME_CHOICE" ||
      pendingReg?.state === "DRIVER_PASSWORD_CREATE" ||
      pendingReg?.state === "DRIVER_PASSWORD_CONFIRM" ||
      pendingReg?.state === "DRIVER_LOGIN_DOCUMENT" ||
      pendingReg?.state === "DRIVER_LOGIN_PASSWORD"
    ) {
      if (
        pendingReg.state === "DRIVER_PASSWORD_CREATE" ||
        pendingReg.state === "DRIVER_PASSWORD_CONFIRM"
      ) {
        await continueDriverPasswordSetup(message, pendingReg);
        return;
      }
      if (
        pendingReg.state === "DRIVER_LOGIN_DOCUMENT" ||
        pendingReg.state === "DRIVER_LOGIN_PASSWORD"
      ) {
        await continueDriverLogin(message, pendingReg);
        return;
      }
      await startDriverRegistration(message.phone);
      return;
    }

    await upsertSession(message.phone, {
      name: message.name,
      state: "IDLE",
      pickupNeighborhood: null,
      driverName: null,
      driverDraft: null,
      driverFlowStep: null,
      driverUpdateCategory: null,
      driverUpdateField: null,
      bookingDraft: null,
    });

    await sendPassengerWelcomeMenu(message.phone);
    return;
  }

  // Intención de servicio sin depender de "Hola" (Agent Zero).
  if (message.text && !message.button) {
    const mobility = parseMobilityIntent(message.text);
    if (mobility.isServiceIntent) {
      const driver = await findDriverByPhone(message.phone);
      if (driver) {
        // Conductores siguen con menú / setup contraseña; no forzar booking.
        await routeAuthenticatedDriverEntry(message.phone, driver);
        return;
      }

      console.log("[core-agent] intención de servicio detectada", {
        phone: message.phone,
        pickupText: mobility.pickupText,
        destinationText: mobility.destinationText,
      });
      await startPassengerRequest(message.phone, message.name, mobility);
      return;
    }
  }

  // Texto no-saludo / sin intención con túnel cerrado → aviso de canal.
  if (message.text) {
    const closed = await notifyIfTunnelClosed(message.phone);
    if (closed) {
      return;
    }

    console.log("[core-agent] sin intención clara", {
      phone: message.phone,
    });
    await sendTextMessage(
      message.phone,
      'Puedes escribir, por ejemplo: "Necesito un servicio en Jordán" o "Estoy en la 60 y voy para Multicentro". También puedes decir Hola para ver el menú.',
    );
  }
}
