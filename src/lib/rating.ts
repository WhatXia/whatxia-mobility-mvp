import { clearSession, upsertSession } from "@/lib/sessions";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import { closeTunnelForTrip } from "@/lib/tunnels";
import { getTrip, samePhone, setTripRating } from "@/lib/trips";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

const RATING_PREFIX = "rating";
const POST_RATING_PREFIX = "post_rating";

const RATING_REPLIES: Record<number, string> = {
  5: "¡Muchas gracias por tu calificación! 😊",
  4: "Gracias por ayudarnos a mejorar.",
  2: "Lamentamos que tu experiencia no haya sido la esperada. Seguiremos mejorando.",
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
  await sendButtonsMessage(passengerPhone, "¿Cómo calificarías tu viaje?", [
    { id: ratingButtonId(5, tripId), title: "⭐⭐⭐⭐⭐ Excelente" },
    { id: ratingButtonId(4, tripId), title: "⭐⭐⭐⭐ Buena" },
    { id: ratingButtonId(2, tripId), title: "⭐⭐ Regular" },
  ]);
}

async function sendPostRatingMenu(passengerPhone: string, tripId: string) {
  // Títulos ≤ 20 caracteres (límite WhatsApp).
  await sendButtonsMessage(passengerPhone, "¿Qué deseas hacer ahora?", [
    {
      id: postRatingButtonId("nuevo", tripId),
      title: "🚖 Nuevo servicio",
    },
    {
      id: postRatingButtonId("salir", tripId),
      title: "❌ Salir",
    },
  ]);
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
      "No encontramos el viaje para calificar.",
    );
    return;
  }

  if (trip.rating !== null) {
    await sendTextMessage(
      passengerPhone,
      "Ya registramos tu calificación. ¡Gracias!",
    );
    await sendPostRatingMenu(passengerPhone, tripId);
    return;
  }

  const updated = await setTripRating(tripId, rating);

  if (!updated) {
    await sendTextMessage(
      passengerPhone,
      "No se pudo guardar tu calificación.",
    );
    return;
  }

  const reply =
    RATING_REPLIES[rating] ?? "¡Gracias por tu calificación!";

  await sendTextMessage(passengerPhone, reply);
  await sendPostRatingMenu(passengerPhone, tripId);

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
      "No encontramos el viaje asociado a esta opción.",
    );
    return;
  }

  await closeTunnelForTrip(tripId);

  if (action === "salir") {
    await clearSession(passengerPhone);
    await sendTextMessage(
      passengerPhone,
      "Listo. El canal se cerró. Escribe Hola cuando quieras volver.",
    );
    console.log("[rating:post] salir", { tripId, passengerPhone });
    return;
  }

  // Nuevo servicio: limpiar contexto e iniciar solicitud (pedir barrio).
  await findOrCreatePassenger(passengerPhone, name);
  await upsertSession(passengerPhone, {
    name,
    state: "WAITING_PICKUP",
    pickupNeighborhood: null,
    driverName: null,
    driverDraft: null,
    driverFlowStep: null,
    driverUpdateCategory: null,
    driverUpdateField: null,
  });

  await sendTextMessage(
    passengerPhone,
    "¿En qué barrio te vamos a recoger?",
  );

  console.log("[rating:post] nuevo servicio", { tripId, passengerPhone });
}
