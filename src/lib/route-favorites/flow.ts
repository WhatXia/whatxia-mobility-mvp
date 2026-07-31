/**
 * Flujo de recorridos favoritos:
 * - Guardado post-calificación
 * - Menú / saludo con botones activos
 * - Uso directo → cotización (vía startBookingFromFavorite)
 */

import type { IncomingMessage, UserSession } from "@/types";
import { clearSession, getSession, upsertSession } from "@/lib/sessions";
import {
  findOrCreatePassenger,
  getPassengerDisplayName,
} from "@/lib/supabase/passengers";
import {
  accessDeniedMessage,
  canPassengerRequestService,
} from "@/lib/passenger-status";
import { getTrip, samePhone } from "@/lib/trips";
import { closeTunnelForTrip } from "@/lib/tunnels";
import { cms, cmsSync } from "@/lib/bot-cms/copy";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  countRouteFavorites,
  createRouteFavorite,
  getRouteFavoriteById,
  listRouteFavorites,
  MAX_ROUTE_FAVORITES,
  tripHasCompleteRoute,
  type RouteFavorite,
} from "@/lib/route-favorites/store";

/** IDs alineados con BUTTON_IDS del handler (evitar import circular). */
const PASSENGER_SOLICITAR_ID = "solicitar_servicio";

export const FAVORITE_BUTTON_IDS = {
  OFFER_YES: "fav_offer_yes",
  OFFER_NO: "fav_offer_no",
  NAME_HOME: "fav_name_casa",
  NAME_OFFICE: "fav_name_oficina",
  NAME_OTHER: "fav_name_other",
  /** @deprecated Usar solicitar_servicio en menús de pasajero. */
  OTHER_DESTINATION: "fav_other_destination",
  FAVORITE_PREFIX: "fav_use:",
} as const;

const PRESET_NAMES: Record<string, string> = {
  [FAVORITE_BUTTON_IDS.NAME_HOME]: "Casa",
  [FAVORITE_BUTTON_IDS.NAME_OFFICE]: "Oficina",
};

function offerYesId(tripId: string) {
  return `${FAVORITE_BUTTON_IDS.OFFER_YES}:${tripId}`;
}
function offerNoId(tripId: string) {
  return `${FAVORITE_BUTTON_IDS.OFFER_NO}:${tripId}`;
}
function nameHomeId(tripId: string) {
  return `${FAVORITE_BUTTON_IDS.NAME_HOME}:${tripId}`;
}
function nameOfficeId(tripId: string) {
  return `${FAVORITE_BUTTON_IDS.NAME_OFFICE}:${tripId}`;
}
function nameOtherId(tripId: string) {
  return `${FAVORITE_BUTTON_IDS.NAME_OTHER}:${tripId}`;
}

export function parseFavoriteOfferButton(
  button: string | null,
): { action: "yes" | "no"; tripId: string } | null {
  if (!button) return null;
  if (button.startsWith(`${FAVORITE_BUTTON_IDS.OFFER_YES}:`)) {
    return {
      action: "yes",
      tripId: button.slice(FAVORITE_BUTTON_IDS.OFFER_YES.length + 1),
    };
  }
  if (button.startsWith(`${FAVORITE_BUTTON_IDS.OFFER_NO}:`)) {
    return {
      action: "no",
      tripId: button.slice(FAVORITE_BUTTON_IDS.OFFER_NO.length + 1),
    };
  }
  return null;
}

export function parseFavoriteNameButton(
  button: string | null,
): { kind: "casa" | "oficina" | "other"; tripId: string } | null {
  if (!button) return null;
  if (button.startsWith(`${FAVORITE_BUTTON_IDS.NAME_HOME}:`)) {
    return {
      kind: "casa",
      tripId: button.slice(FAVORITE_BUTTON_IDS.NAME_HOME.length + 1),
    };
  }
  if (button.startsWith(`${FAVORITE_BUTTON_IDS.NAME_OFFICE}:`)) {
    return {
      kind: "oficina",
      tripId: button.slice(FAVORITE_BUTTON_IDS.NAME_OFFICE.length + 1),
    };
  }
  if (button.startsWith(`${FAVORITE_BUTTON_IDS.NAME_OTHER}:`)) {
    return {
      kind: "other",
      tripId: button.slice(FAVORITE_BUTTON_IDS.NAME_OTHER.length + 1),
    };
  }
  return null;
}

export function parseFavoriteUseButton(button: string | null): string | null {
  if (!button?.startsWith(FAVORITE_BUTTON_IDS.FAVORITE_PREFIX)) {
    return null;
  }
  const id = button.slice(FAVORITE_BUTTON_IDS.FAVORITE_PREFIX.length).trim();
  return id || null;
}

export function isFavoriteFlowButton(button: string | null): boolean {
  return (
    parseFavoriteOfferButton(button) !== null ||
    parseFavoriteNameButton(button) !== null ||
    parseFavoriteUseButton(button) !== null
  );
}

/**
 * Saludo / home con favoritos.
 * UX-002: sin Cancelar (no hay operación activa).
 * Favoritos + Solicitar (máx. 3 botones WA).
 */
export function buildFavoritesGreeting(
  passengerName: string,
  favorites: RouteFavorite[],
): {
  body: string;
  buttons: Array<{ id: string; title: string }>;
} {
  const name = passengerName.trim() || "amigo";
  const body = cmsSync("P_HOME_GREETING", {
    nombre: name,
    fav_id: "",
    fav_name: "",
  });
  const slice = favorites.slice(0, MAX_ROUTE_FAVORITES);
  const buttons: Array<{ id: string; title: string }> = slice.map((fav) => ({
    id: `${FAVORITE_BUTTON_IDS.FAVORITE_PREFIX}${fav.id}`,
    title: fav.name.slice(0, 20),
  }));

  // Título ≤ 20 (límite WhatsApp); emoji + "Solicitar servicio" excede.
  buttons.push({
    id: PASSENGER_SOLICITAR_ID,
    title: "Solicitar servicio",
  });

  return { body, buttons };
}

export type SendPassengerActionMenuOptions = {
  /** Cuerpo CTA (cancelación / éxito). Evita repetir saludo ¡Hola! al cerrar un flujo. */
  body?: string;
};

/**
 * Menú de acción del pasajero (siempre envía botones).
 * UX-002: solo Solicitar (+ favoritos si hay). Sin Cancelar — no hay operación activa.
 */
export async function sendPassengerActionMenu(
  phone: string,
  displayName: string = "",
  options?: SendPassengerActionMenuOptions,
): Promise<void> {
  const passenger = await findOrCreatePassenger(phone, displayName);
  const name = getPassengerDisplayName(passenger, displayName || "amigo");

  // USER-001: PIONEER / BLOCKED no ven menú de solicitud.
  if (!canPassengerRequestService(passenger.status)) {
    await upsertSession(phone, {
      name: displayName || passenger.name || undefined,
      state: "IDLE",
      pickupNeighborhood: null,
      driverName: null,
      driverDraft: null,
      driverFlowStep: null,
      driverUpdateCategory: null,
      driverUpdateField: null,
      bookingDraft: null,
    });
    await sendTextMessage(
      phone,
      await accessDeniedMessage(passenger.status, passenger.preferred_name),
    );
    return;
  }

  const favorites = await listRouteFavorites(passenger.id);

  const fallbackButtons = [
    {
      id: PASSENGER_SOLICITAR_ID,
      title: "Solicitar servicio",
    },
  ];

  const greeting =
    favorites.length > 0
      ? buildFavoritesGreeting(name, favorites)
      : {
          body: cmsSync("P_HOME_GREETING", {
            nombre: name,
            fav_id: "",
            fav_name: "",
          }),
          buttons: fallbackButtons,
        };

  const body = options?.body?.trim() || greeting.body;
  const buttons = greeting.buttons;

  await upsertSession(phone, {
    name: displayName || passenger.name || undefined,
    state: "IDLE",
    pickupNeighborhood: null,
    driverName: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
    bookingDraft: null,
  });

  await sendButtonsMessage(phone, body, buttons);
}

/**
 * Alias de sendPassengerActionMenu (compat con saludo / favoritos).
 * @returns siempre true (el menú se envía con o sin favoritos)
 */
export async function sendFavoritesHomeMenu(
  phone: string,
  displayName: string,
): Promise<boolean> {
  await sendPassengerActionMenu(phone, displayName);
  return true;
}

export async function handleUseFavorite(
  phone: string,
  name: string,
  favoriteId: string,
): Promise<void> {
  const passenger = await findOrCreatePassenger(phone, name);
  const favorite = await getRouteFavoriteById(favoriteId);

  if (!favorite || favorite.passengerId !== passenger.id) {
    await sendTextMessage(phone, await cms("P_FAV_NOT_FOUND"));
    await sendPassengerActionMenu(phone, name);
    return;
  }

  const { startBookingFromFavorite } = await import("@/lib/booking/flow");
  await startBookingFromFavorite(phone, name, favorite);
}

export async function offerSaveFavoriteAfterRating(
  passengerPhone: string,
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    return;
  }

  if (!tripHasCompleteRoute(trip)) {
    await sendPassengerActionMenu(passengerPhone);
    return;
  }

  const passenger = await findOrCreatePassenger(passengerPhone);
  const count = await countRouteFavorites(passenger.id);

  if (count >= MAX_ROUTE_FAVORITES) {
    // La calificación ya envió el agradecimiento; aquí solo el CTA.
    await sendPassengerActionMenu(
      passengerPhone,
      passenger.name || trip.passengerPhone,
      {
        body: await cms("P_FAV_THANKS_MAX"),
      },
    );
    return;
  }

  await upsertSession(passengerPhone, {
    state: "FAVORITE_OFFER",
    driverFlowStep: tripId,
    bookingDraft: null,
  });


  await sendButtonsMessage(
    passengerPhone,
    await cms("P_FAV_OFFER"),
    [
      { id: offerYesId(tripId), title: "✅ Sí" },
      { id: offerNoId(tripId), title: "❌ No" },
    ],
  );
}

async function askFavoriteName(phone: string, tripId: string): Promise<void> {
  await upsertSession(phone, {
    state: "FAVORITE_NAME_CHOICE",
    driverFlowStep: tripId,
  });

  await sendButtonsMessage(
    phone,
    await cms("P_FAV_NAME_CHOICE"),
    [
      { id: nameHomeId(tripId), title: "🏠 Casa" },
      { id: nameOfficeId(tripId), title: "🏢 Oficina" },
      { id: nameOtherId(tripId), title: "✏️ Otro nombre" },
    ],
  );
}

async function finishFavoriteSave(
  phone: string,
  tripId: string,
  favoriteName: string,
): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || !samePhone(trip.passengerPhone, phone)) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      await cms("P_FAV_TRIP_MISSING"),
    );
    await sendPassengerActionMenu(phone);
    return;
  }

  if (!tripHasCompleteRoute(trip)) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      await cms("P_FAV_INCOMPLETE_ROUTE"),
    );
    await sendPassengerActionMenu(phone);
    return;
  }

  const passenger = await findOrCreatePassenger(phone);
  const count = await countRouteFavorites(passenger.id);

  if (count >= MAX_ROUTE_FAVORITES) {
    await sendTextMessage(
      phone,
      await cms("P_FAV_MAX_REACHED"),
    );
    await sendPassengerActionMenu(phone, passenger.name || "");
    return;
  }

  const saved = await createRouteFavorite({
    passengerId: passenger.id,
    name: favoriteName,
    trip,
  });

  await closeTunnelForTrip(tripId).catch(() => undefined);

  if (!saved) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      await cms("P_FAV_SAVE_FAILED"),
    );
    await sendPassengerActionMenu(phone, passenger.name || "");
    return;
  }

  // Activa botones de inmediato (confirmación + CTA, sin saludo ¡Hola!).
  await sendPassengerActionMenu(phone, passenger.name || "", {
    body: await cms("P_FAV_SAVED", { fav_name: saved.name }),
  });
  console.log("[route-favorites] guardado", {
    favoriteId: saved.id,
    passengerId: passenger.id,
    name: saved.name,
    tripId,
  });
}

export async function handleFavoriteOfferChoice(
  phone: string,
  action: "yes" | "no",
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);
  if (!trip || !samePhone(trip.passengerPhone, phone)) {
    await clearSession(phone);
    await sendTextMessage(phone, await cms("P_FAV_TRIP_ASSOC_MISSING"));
    return;
  }

  if (action === "no") {
    await clearSession(phone);
    await sendPassengerActionMenu(phone, "", {
      body: await cms("P_POST_RATING_CTA"),
    });
    return;
  }

  const passenger = await findOrCreatePassenger(phone);
  const count = await countRouteFavorites(passenger.id);
  if (count >= MAX_ROUTE_FAVORITES) {
    await sendTextMessage(
      phone,
      await cms("P_FAV_MAX_REACHED"),
    );
    await sendPassengerActionMenu(phone, passenger.name || "");
    return;
  }

  await askFavoriteName(phone, tripId);
}

export async function handleFavoriteNameChoice(
  phone: string,
  kind: "casa" | "oficina" | "other",
  tripId: string,
): Promise<void> {
  if (kind === "other") {
    await upsertSession(phone, {
      state: "FAVORITE_CUSTOM_NAME",
      driverFlowStep: tripId,
    });
    await sendTextMessage(
      phone,
      await cms("P_FAV_CUSTOM_NAME_PROMPT"),
    );
    return;
  }

  const name =
    kind === "casa"
      ? PRESET_NAMES[FAVORITE_BUTTON_IDS.NAME_HOME]
      : PRESET_NAMES[FAVORITE_BUTTON_IDS.NAME_OFFICE];

  await finishFavoriteSave(phone, tripId, name);
}

export function isFavoriteFlowState(
  session: UserSession | undefined,
): boolean {
  return (
    session?.state === "FAVORITE_OFFER" ||
    session?.state === "FAVORITE_NAME_CHOICE" ||
    session?.state === "FAVORITE_CUSTOM_NAME"
  );
}

export async function getActiveFavoriteSession(
  phone: string,
): Promise<UserSession | undefined> {
  const session = await getSession(phone);
  return isFavoriteFlowState(session) ? session : undefined;
}

export async function continueFavoriteFlow(
  message: IncomingMessage,
  session: UserSession,
): Promise<boolean> {
  if (!isFavoriteFlowState(session)) {
    return false;
  }

  const tripId = session.driverFlowStep;
  if (!tripId) {
    await clearSession(message.phone);
    return true;
  }

  if (session.state === "FAVORITE_CUSTOM_NAME") {
    if (!message.text?.trim()) {
      await sendTextMessage(
        message.phone,
        await cms("P_FAV_CUSTOM_NAME_PROMPT"),
      );
      return true;
    }
    await finishFavoriteSave(message.phone, tripId, message.text.trim());
    return true;
  }

  if (session.state === "FAVORITE_OFFER") {
    await sendButtonsMessage(
      message.phone,
      await cms("P_FAV_OFFER"),
      [
        { id: offerYesId(tripId), title: "✅ Sí" },
        { id: offerNoId(tripId), title: "❌ No" },
      ],
    );
    return true;
  }

  if (session.state === "FAVORITE_NAME_CHOICE") {
    await askFavoriteName(message.phone, tripId);
    return true;
  }

  return true;
}

export { listRouteFavorites, MAX_ROUTE_FAVORITES };
