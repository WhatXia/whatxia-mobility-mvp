/**
 * Flujo: conductor califica al pasajero al finalizar el viaje.
 */

import { sendDriverMainMenu } from "@/lib/driver-menu";
import { findDriverByPhone } from "@/lib/supabase/drivers";
import { findOrCreatePassenger } from "@/lib/supabase/passengers";
import { getTrip, samePhone } from "@/lib/trips";
import { sendButtonsMessage, sendTextMessage } from "@/lib/whatsapp/client";
import {
  createPassengerRating,
  getPassengerRatingByTripId,
} from "@/lib/reputation/store";

async function returnDriverToMainMenu(driverPhone: string): Promise<void> {
  const driver = await findDriverByPhone(driverPhone);
  if (!driver) {
    return;
  }
  // Menú existente; refleja is_available actual (sin forzar estado).
  await sendDriverMainMenu(driver, driverPhone);
}

const DRIVER_RATES_PAX_PREFIX = "pax_rating";

const DRIVER_RATING_REPLIES: Record<number, string> = {
  5: "¡Gracias! Registramos tu calificación del pasajero. ⭐",
  4: "Gracias. Registramos tu calificación del pasajero.",
  2: "Gracias. Registramos tu calificación del pasajero.",
};

function driverRatesPaxButtonId(rating: number, tripId: string) {
  return `${DRIVER_RATES_PAX_PREFIX}:${rating}:${tripId}`;
}

export function parseDriverRatesPassengerButton(
  button: string | null,
): { tripId: string; rating: number } | null {
  if (!button?.startsWith(`${DRIVER_RATES_PAX_PREFIX}:`)) {
    return null;
  }

  const rest = button.slice(DRIVER_RATES_PAX_PREFIX.length + 1);
  const [ratingRaw, ...tripParts] = rest.split(":");
  const rating = Number(ratingRaw);
  const tripId = tripParts.join(":");

  if (![5, 4, 2].includes(rating) || !tripId) {
    return null;
  }

  return { tripId, rating };
}

export async function sendDriverRatesPassengerPrompt(
  driverPhone: string,
  tripId: string,
): Promise<void> {
  await sendButtonsMessage(
    driverPhone,
    "¿Cómo fue tu experiencia con este pasajero?",
    [
      {
        id: driverRatesPaxButtonId(5, tripId),
        title: "⭐⭐⭐⭐⭐ Excelente",
      },
      {
        id: driverRatesPaxButtonId(4, tripId),
        title: "⭐⭐⭐⭐ Buena",
      },
      {
        id: driverRatesPaxButtonId(2, tripId),
        title: "⭐⭐⭐ Regular",
      },
    ],
  );
}

export async function handleDriverRatesPassenger(
  driverPhone: string,
  tripId: string,
  rating: number,
): Promise<void> {
  const trip = await getTrip(tripId);

  if (!trip || trip.status !== "COMPLETED") {
    await sendTextMessage(
      driverPhone,
      "No encontramos el viaje para calificar al pasajero.",
    );
    return;
  }

  if (
    !trip.assignedDriverPhone ||
    !samePhone(trip.assignedDriverPhone, driverPhone)
  ) {
    await sendTextMessage(
      driverPhone,
      "Solo el conductor del viaje puede calificar al pasajero.",
    );
    return;
  }

  if (!trip.assignedDriverId) {
    await sendTextMessage(
      driverPhone,
      "No se pudo identificar al conductor para guardar la calificación.",
    );
    return;
  }

  const already = await getPassengerRatingByTripId(tripId);
  if (already) {
    await sendTextMessage(
      driverPhone,
      "Ya registramos tu calificación de este pasajero. ¡Gracias!",
    );
    await returnDriverToMainMenu(driverPhone);
    return;
  }

  const passenger = await findOrCreatePassenger(trip.passengerPhone);
  const passengerId = trip.passengerId ?? passenger.id;

  const saved = await createPassengerRating({
    tripId,
    driverId: trip.assignedDriverId,
    passengerId,
    rating,
  });

  if (!saved) {
    await sendTextMessage(
      driverPhone,
      "No se pudo guardar la calificación del pasajero.",
    );
    await returnDriverToMainMenu(driverPhone);
    return;
  }

  const reply =
    DRIVER_RATING_REPLIES[rating] ??
    "¡Gracias! Registramos tu calificación del pasajero.";

  await sendTextMessage(driverPhone, reply);
  await returnDriverToMainMenu(driverPhone);

  console.log("[reputation] conductor calificó pasajero", {
    tripId,
    driverId: trip.assignedDriverId,
    passengerId,
    rating,
  });
}
