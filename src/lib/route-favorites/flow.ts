/**
 * Flujo de guardado de favoritos (post-calificación).
 *
 * Sprint actual: solo guardar.
 * Siguiente sprint: saludo con botones de favoritos + "Otro destino"
 * vía `buildFavoritesGreeting` / `listRouteFavorites` (ya exportados).
 */

import type { IncomingMessage, UserSession } from "@/types";
import { clearSession, getSession, upsertSession } from "@/lib/sessions";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import { getTrip, samePhone } from "@/lib/trips";
import { closeTunnelForTrip } from "@/lib/tunnels";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  countRouteFavorites,
  createRouteFavorite,
  listRouteFavorites,
  MAX_ROUTE_FAVORITES,
  tripHasCompleteRoute,
  type RouteFavorite,
} from "@/lib/route-favorites/store";

export const FAVORITE_BUTTON_IDS = {
  OFFER_YES: "fav_offer_yes",
  OFFER_NO: "fav_offer_no",
  NAME_HOME: "fav_name_casa",
  NAME_OFFICE: "fav_name_oficina",
  NAME_OTHER: "fav_name_other",
  /** Preparado para el siguiente sprint (saludo con favoritos). */
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

export function isFavoriteFlowButton(button: string | null): boolean {
  return (
    parseFavoriteOfferButton(button) !== null ||
    parseFavoriteNameButton(button) !== null
  );
}

/**
 * Preparado para el siguiente sprint: saludo con favoritos.
 * No cablear aún en el menú de pasajero.
 */
export function buildFavoritesGreeting(
  passengerName: string,
  favorites: RouteFavorite[],
): {
  body: string;
  buttons: Array<{ id: string; title: string }>;
} {
  const name = passengerName.trim() || "amigo";
  const body = `¡Hola, ${name}! ¿A dónde vamos hoy?`;
  const buttons: Array<{ id: string; title: string }> = favorites
    .slice(0, MAX_ROUTE_FAVORITES)
    .map((fav) => ({
      id: `${FAVORITE_BUTTON_IDS.FAVORITE_PREFIX}${fav.id}`,
      title: fav.name.slice(0, 20),
    }));

  buttons.push({
    id: FAVORITE_BUTTON_IDS.OTHER_DESTINATION,
    title: "➕ Otro destino",
  });

  return { body, buttons };
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
    // Sin geo completo no se puede guardar el recorrido; flujo normal.
    const { sendPostRatingMenu } = await import("@/lib/rating");
    await sendPostRatingMenu(passengerPhone, tripId);
    return;
  }

  const passenger = await findOrCreatePassenger(passengerPhone);
  const count = await countRouteFavorites(passenger.id);

  if (count >= MAX_ROUTE_FAVORITES) {
    await sendTextMessage(
      passengerPhone,
      [
        "Ya tienes tus dos recorridos favoritos configurados.",
        "Si deseas cambiar alguno, primero deberás reemplazar uno existente.",
      ].join("\n"),
    );
    const { sendPostRatingMenu } = await import("@/lib/rating");
    await sendPostRatingMenu(passengerPhone, tripId);
    return;
  }

  await upsertSession(passengerPhone, {
    state: "FAVORITE_OFFER",
    driverFlowStep: tripId,
    bookingDraft: null,
  });

  await sendButtonsMessage(
    passengerPhone,
    "¿Deseas guardar este recorrido como favorito?",
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
    "¿Cómo quieres llamar este recorrido favorito?",
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
      "No encontramos el recorrido para guardar como favorito.",
    );
    return;
  }

  if (!tripHasCompleteRoute(trip)) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      "No pudimos guardar este recorrido porque faltan datos de origen o destino.",
    );
    return;
  }

  const passenger = await findOrCreatePassenger(phone);
  const count = await countRouteFavorites(passenger.id);

  if (count >= MAX_ROUTE_FAVORITES) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      [
        "Ya tienes tus dos recorridos favoritos configurados.",
        "Si deseas cambiar alguno, primero deberás reemplazar uno existente.",
      ].join("\n"),
    );
    return;
  }

  const saved = await createRouteFavorite({
    passengerId: passenger.id,
    name: favoriteName,
    trip,
  });

  await clearSession(phone);
  await closeTunnelForTrip(tripId).catch(() => undefined);

  if (!saved) {
    await sendTextMessage(
      phone,
      "No se pudo guardar el recorrido favorito. Intenta más adelante.",
    );
    return;
  }

  await sendTextMessage(
    phone,
    [
      "✅ ¡Listo!",
      "",
      `Tu recorrido favorito quedó guardado con el nombre "${saved.name}".`,
      "",
      "La próxima vez solo tendrás que pulsar ese botón para solicitar este recorrido.",
      "",
      "¡Gracias por elegir WhatXia! 🚖",
    ].join("\n"),
  );

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
    await sendTextMessage(phone, "No encontramos el viaje asociado.");
    return;
  }

  if (action === "no") {
    await clearSession(phone);
    const { sendPostRatingMenu } = await import("@/lib/rating");
    await sendPostRatingMenu(phone, tripId);
    return;
  }

  const passenger = await findOrCreatePassenger(phone);
  const count = await countRouteFavorites(passenger.id);
  if (count >= MAX_ROUTE_FAVORITES) {
    await clearSession(phone);
    await sendTextMessage(
      phone,
      [
        "Ya tienes tus dos recorridos favoritos configurados.",
        "Si deseas cambiar alguno, primero deberás reemplazar uno existente.",
      ].join("\n"),
    );
    const { sendPostRatingMenu } = await import("@/lib/rating");
    await sendPostRatingMenu(phone, tripId);
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
      "Escribe el nombre que deseas darle a este recorrido.",
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
        "Escribe el nombre que deseas darle a este recorrido.",
      );
      return true;
    }
    await finishFavoriteSave(message.phone, tripId, message.text.trim());
    return true;
  }

  // Botones se manejan en el handler; si llega texto, re-ofrecer.
  if (session.state === "FAVORITE_OFFER") {
    await sendButtonsMessage(
      message.phone,
      "¿Deseas guardar este recorrido como favorito?",
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

/** Re-export para el siguiente sprint. */
export { listRouteFavorites, MAX_ROUTE_FAVORITES };
