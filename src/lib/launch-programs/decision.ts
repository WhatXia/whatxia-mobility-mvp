/**
 * Decisión pura: ¿el programa Pioneros acepta nuevos registros?
 * Sin I/O — usada por runtime y por certify (BOT-001 / CFG-001).
 */

export type PioneerAcceptInput = {
  isActive: boolean;
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  maxQuota: number | null | undefined;
  registeredPioneers: number;
  /** epoch ms; default Date.now() */
  nowMs?: number;
};

/**
 * true solo si el programa está activo, dentro de ventana y bajo cupo.
 * Si isActive es false → nunca acepta (BOT-001).
 */
export function computeAcceptsNewPioneers(input: PioneerAcceptInput): boolean {
  if (!input.isActive) return false;

  const now = input.nowMs ?? Date.now();
  const withinStart =
    !input.startsAt || now >= new Date(input.startsAt).getTime();
  const withinEnd = !input.endsAt || now <= new Date(input.endsAt).getTime();
  const underQuota =
    input.maxQuota == null ||
    input.registeredPioneers < Number(input.maxQuota);

  return withinStart && withinEnd && underQuota;
}

export function statusForNewPassenger(
  acceptsNewPioneers: boolean,
): "PIONEER" | "ACTIVE" {
  return acceptsNewPioneers ? "PIONEER" : "ACTIVE";
}
