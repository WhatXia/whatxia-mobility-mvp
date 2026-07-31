/**
 * Estados de acceso del pasajero (USER-001) + Programa de Lanzamiento (CFG-001).
 * El status inicial de usuarios nuevos lo define `launch_programs` en Supabase.
 */

import {
  accessDeniedMessage as accessDeniedMessageFromProgram,
  defaultStatusForNewPassenger as defaultStatusFromProgram,
  isPreLaunchMode as isPreLaunchModeFromProgram,
  pioneerWelcomeMessage as pioneerWelcomeFromProgram,
} from "@/lib/launch-programs/config";
import { catalogBody } from "@/lib/bot-cms/copy";

export const PASSENGER_STATUSES = [
  "PIONEER",
  "BETA",
  "ACTIVE",
  "BLOCKED",
] as const;

export type PassengerStatus = (typeof PASSENGER_STATUSES)[number];

export function isPassengerStatus(value: unknown): value is PassengerStatus {
  return (
    typeof value === "string" &&
    (PASSENGER_STATUSES as readonly string[]).includes(value)
  );
}

/** Quién puede solicitar servicios. */
export function canPassengerRequestService(
  status: PassengerStatus | string | null | undefined,
): boolean {
  return status === "ACTIVE" || status === "BETA";
}

/** Vigencia del programa Pioneros (DB). Reemplaza PRE_LAUNCH_MODE. */
export async function isPreLaunchMode(): Promise<boolean> {
  return isPreLaunchModeFromProgram();
}

export async function defaultStatusForNewPassenger(): Promise<PassengerStatus> {
  return defaultStatusFromProgram();
}

export async function pioneerWelcomeMessage(
  preferredName?: string | null,
): Promise<string> {
  return pioneerWelcomeFromProgram(preferredName);
}

/** @deprecated usar pioneerWelcomeMessage(preferredName) */
// TODO(bot-cms): no catalog code for this exact deprecated string — use pioneerWelcomeMessage()
export const PIONEER_WELCOME_MESSAGE = catalogBody("P_PIONEER_WELCOME_FALLBACK").replace(
  "{{nombre}}",
  "Pionero",
);

export async function accessDeniedMessage(
  status: PassengerStatus | string | null | undefined,
  preferredName?: string | null,
): Promise<string> {
  return accessDeniedMessageFromProgram(status, preferredName);
}
