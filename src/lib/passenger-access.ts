/**
 * Gate de acceso a solicitud de servicio (USER-001).
 * Depende del status del pasajero, no del Feature Flag.
 */

import {
  accessDeniedMessage,
  canPassengerRequestService,
} from "@/lib/passenger-status";
import {
  findOrCreatePassenger,
  type PassengerRow,
} from "@/lib/supabase/passengers";
import { sendTextMessage } from "@/lib/whatsapp/client";

export async function assertPassengerCanRequestService(
  phone: string,
  whatsappName?: string,
): Promise<PassengerRow | null> {
  const passenger = await findOrCreatePassenger(phone, whatsappName);
  if (canPassengerRequestService(passenger.status)) {
    return passenger;
  }

  await sendTextMessage(phone, accessDeniedMessage(passenger.status));
  console.log("[passenger-access] solicitud bloqueada", {
    phone: passenger.phone,
    status: passenger.status,
  });
  return null;
}
