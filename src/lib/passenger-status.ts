/**
 * Estados de acceso del pasajero + Feature Flag PRE_LAUNCH_MODE (USER-001).
 * El gating depende de status; el flag solo define el status inicial de usuarios nuevos.
 */

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

/** Feature Flag: true → nuevos usuarios como PIONEER; false → ACTIVE. */
export function isPreLaunchMode(): boolean {
  const raw = process.env.PRE_LAUNCH_MODE?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Status inicial al crear un pasajero (reutilizable en futuros lanzamientos). */
export function defaultStatusForNewPassenger(): PassengerStatus {
  return isPreLaunchMode() ? "PIONEER" : "ACTIVE";
}

/** Quién puede solicitar servicios. */
export function canPassengerRequestService(
  status: PassengerStatus | string | null | undefined,
): boolean {
  return status === "ACTIVE" || status === "BETA";
}

/** Mensaje final de onboarding / re-saludo Pionero (USER-001.3). */
export function pioneerWelcomeMessage(
  preferredName?: string | null,
): string {
  const name = preferredName?.trim() || "Pionero";
  return [
    `🎉 ¡${name}, ya eres un Pionero de WhatXia!`,
    "",
    "Tu registro quedó confirmado.",
    "",
    "Desde hoy haces parte de los primeros colombianos en descubrir una nueva forma de vivir la movilidad.",
    "",
    "Muy pronto recibirás noticias exclusivas y el acceso al lanzamiento oficial.",
    "",
    "🚀 Gracias por creer en WhatXia desde el principio. Lo mejor está por comenzar.",
  ].join("\n");
}

/** @deprecated usar pioneerWelcomeMessage(preferredName) */
export const PIONEER_WELCOME_MESSAGE = pioneerWelcomeMessage();

export function accessDeniedMessage(
  status: PassengerStatus | string | null | undefined,
  preferredName?: string | null,
): string {
  if (status === "BLOCKED") {
    return "Tu cuenta está bloqueada. Si crees que es un error, comunícate con WhatXia.";
  }
  if (status === "PIONEER") {
    return pioneerWelcomeMessage(preferredName);
  }
  return "Aún no tienes acceso para solicitar servicios. Pronto te avisaremos.";
}
