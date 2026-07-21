import { getTrip, setTripRating } from "@/lib/trips";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";

const RATING_PREFIX = "rating";

const RATING_REPLIES: Record<number, string> = {
  5: "¡Muchas gracias por tu calificación! 😊",
  4: "Gracias por ayudarnos a mejorar.",
  2: "Lamentamos que tu experiencia no haya sido la esperada. Seguiremos mejorando.",
};

function ratingButtonId(rating: number, tripId: string) {
  return `${RATING_PREFIX}:${rating}:${tripId}`;
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

export async function sendRatingPrompt(passengerPhone: string, tripId: string) {
  // Títulos ≤ 20 caracteres (límite WhatsApp).
  await sendButtonsMessage(passengerPhone, "¿Cómo calificarías tu viaje?", [
    { id: ratingButtonId(5, tripId), title: "⭐⭐⭐⭐⭐ Excelente" },
    { id: ratingButtonId(4, tripId), title: "⭐⭐⭐⭐ Buena" },
    { id: ratingButtonId(2, tripId), title: "⭐⭐ Regular" },
  ]);
}

export async function handlePassengerRating(
  passengerPhone: string,
  tripId: string,
  rating: number,
): Promise<void> {
  const trip = getTrip(tripId);

  if (!trip || trip.passengerPhone !== passengerPhone) {
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
    return;
  }

  const updated = setTripRating(tripId, rating);

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

  console.log("[rating] calificación guardada:", {
    tripId: updated.id,
    rating: updated.rating,
    passengerPhone,
  });
}
