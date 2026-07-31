import { catalogBody, cms } from "@/lib/bot-cms/copy";
import { clearSession } from "@/lib/sessions";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import { closeTunnelForTrip } from "@/lib/tunnels";
import { getTrip, samePhone, setTripRating } from "@/lib/trips";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import { startBookingFlow } from "@/lib/booking/flow";
import { offerSaveFavoriteAfterRating } from "@/lib/route-favorites/flow";

const RATING_PREFIX = "rating";
const POST_RATING_PREFIX = "post_rating";

const RATING_REPLY_CODES: Record<number, string> = {
  5: "P_RATING_REPLY_5",
  4: "P_RATING_REPLY_4",
  2: "P_RATING_REPLY_2",
};

function ratingButtonId(rating: number, tripId: string) {
  return `${RATING_PREFIX}:${rating}:${tripId}`;
}

function postRatingButtonId(
  action: "nuevo" | "salir",
  tripId: string,
): string {
  return `${POST_RATING_PREFIX}:${action}:${tripId}`;
}

export function parseRatingButton(
  button: string | null,
): { tripId: string; rating: number } | null {
  if (!button?.startsWith(`${RATING_PREFIX}:`)) {
    return null;
  }

  const rest = button.slice(RATING_PREFIX.length + 1);
  const [ratingRaw, ...tripParts] = rest.split(":");
  const rating = Number(ratingRaw);
  const tripId = tripParts.join(":");

  if (![5, 4, 2].includes(rating) || !tripId) {
    return null;
  }

  return { tripId, rating };
}

export function parsePostRatingButton(
  button: string | null,
): { action: "nuevo" | "salir"; tripId: string } | null {
  if (!button?.startsWith(`${POST_RATING_PREFIX}:`)) {
    return null;
  }

  const rest = button.slice(POST_RATING_PREFIX.length + 1);
  const [actionRaw, ...tripParts] = rest.split(":");
  const tripId = tripParts.join(":");

  if ((actionRaw !== "nuevo" && actionRaw !== "salir") || !tripId) {
    return null;
  }

  return { action: actionRaw, tripId };
}

export async function sendRatingPrompt(passengerPhone: string, tripId: string) {
  // Títulos ≤ 20 caracteres (límite WhatsApp).
  await sendButtonsMessage(
    passengerPhone,
    await cms("P_RATING_PROMPT"),
    [
      { id: ratingButtonId(5, tripId), title: "⭐⭐⭐⭐⭐ Excelente" },
      { id: ratingButtonId(4, tripId), title: "⭐⭐⭐⭐ Buena" },
      { id: ratingButtonId(2, tripId), title: "⭐⭐ Regular" },
    ],
  );
}

export async function sendPostRatingMenu(
  passengerPhone: string,
  _tripId: string,
) {
  // Menú continuo: favoritos / Solicitar (UX-002: sin Cancelar).
  const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
  await sendPassengerActionMenu(passengerPhone, "", {
    body: await cms("P_POST_RATING_CTA"),
  });
}

export async function handlePassengerRating(
  passengerPhone: string,
  tripId: string,
  rating: number,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(
      passengerPhone,
      await cms("P_RATING_TRIP_MISSING"),
    );
    return;
  }

  if (trip.rating !== null) {
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(passengerPhone, "", {
      body: await cms("P_RATING_ALREADY"),
    });
    return;
  }

  const updated = await setTripRating(tripId, rating);

  if (!updated) {
    await sendTextMessage(
      passengerPhone,
      await cms("P_RATING_SAVE_FAIL"),
    );
    return;
  }

  const code =
    RATING_REPLY_CODES[rating] ?? "P_RATING_REPLY_DEFAULT";
  await sendTextMessage(passengerPhone, await cms(code));

  // Favoritos inteligentes: ofrecer guardar recorrido (origen + destino).
  await offerSaveFavoriteAfterRating(passengerPhone, tripId);

  console.log("[rating] calificación guardada:", {
    tripId: updated.id,
    rating: updated.rating,
    passengerPhone,
  });
}

/**
 * Tras calificar: cierra el túnel y reinicia solicitud o sale.
 * No afecta el túnel durante un viaje activo (solo post-finalización).
 */
export async function handlePostRatingChoice(
  passengerPhone: string,
  name: string,
  action: "nuevo" | "salir",
  tripId: string,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || !samePhone(trip.passengerPhone, passengerPhone)) {
    await sendTextMessage(
      passengerPhone,
      await cms("P_POST_RATING_TRIP_MISSING"),
    );
    return;
  }

  await closeTunnelForTrip(tripId);

  if (action === "salir") {
    await clearSession(passengerPhone);
    const { sendPassengerActionMenu } = await import("@/lib/route-favorites");
    await sendPassengerActionMenu(passengerPhone, name, {
      body: await cms("P_POST_RATING_CHANNEL_CLOSED"),
    });
    console.log("[rating:post] salir", { tripId, passengerPhone });
    return;
  }

  // Nuevo servicio: cotización geográfica (origen → destino → tarifa).
  await findOrCreatePassenger(passengerPhone, name);
  await startBookingFlow(passengerPhone, name);

  console.log("[rating:post] nuevo servicio", { tripId, passengerPhone });
}

/** @deprecated usar RATING_REPLY_CODES + cms */
export const RATING_REPLIES: Record<number, string> = {
  5: catalogBody("P_RATING_REPLY_5"),
  4: catalogBody("P_RATING_REPLY_4"),
  2: catalogBody("P_RATING_REPLY_2"),
};
