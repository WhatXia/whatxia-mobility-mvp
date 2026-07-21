import type { DriverRow } from "@/lib/supabase/drivers";

export type DocumentType = "soat" | "techno" | "license";

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  soat: "SOAT",
  techno: "revisión tecnomecánica",
  license: "licencia de conducción",
};

export const DOCUMENT_FIELDS: Record<
  DocumentType,
  "soat_expires_at" | "techno_expires_at" | "license_expires_at"
> = {
  soat: "soat_expires_at",
  techno: "techno_expires_at",
  license: "license_expires_at",
};

export const REMINDER_DAYS = [30, 15, 7, 1] as const;

export type ReminderDay = (typeof REMINDER_DAYS)[number];

/** Fecha de hoy en YYYY-MM-DD (calendario local del servidor). */
export function todayDateOnly(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Válido durante toda la fecha de vencimiento (hasta 23:59:59).
 * Vencido desde el día siguiente 00:00:00 → comparar solo por fecha:
 * expires_on < today ⇒ vencido.
 */
export function isDocumentExpired(
  expiresOn: string | null | undefined,
  today: string = todayDateOnly(),
): boolean {
  if (!expiresOn) {
    return false;
  }

  const expiry = expiresOn.slice(0, 10);
  return expiry < today;
}

/** Días calendarios hasta la fecha de vencimiento (0 = vence hoy, aún válido). */
export function daysUntilExpiry(
  expiresOn: string,
  today: string = todayDateOnly(),
): number {
  const start = parseDateOnly(today);
  const end = parseDateOnly(expiresOn.slice(0, 10));
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function getExpiredDocuments(
  driver: Pick<
    DriverRow,
    "soat_expires_at" | "techno_expires_at" | "license_expires_at"
  >,
  today: string = todayDateOnly(),
): DocumentType[] {
  const expired: DocumentType[] = [];

  for (const type of Object.keys(DOCUMENT_FIELDS) as DocumentType[]) {
    const field = DOCUMENT_FIELDS[type];
    if (isDocumentExpired(driver[field], today)) {
      expired.push(type);
    }
  }

  return expired;
}

export function hasExpiredDocuments(
  driver: Pick<
    DriverRow,
    "soat_expires_at" | "techno_expires_at" | "license_expires_at"
  >,
  today: string = todayDateOnly(),
): boolean {
  return getExpiredDocuments(driver, today).length > 0;
}

export function getReminderTargets(
  driver: Pick<
    DriverRow,
    "soat_expires_at" | "techno_expires_at" | "license_expires_at"
  >,
  today: string = todayDateOnly(),
): Array<{ type: DocumentType; daysBefore: ReminderDay; expiresOn: string }> {
  const targets: Array<{
    type: DocumentType;
    daysBefore: ReminderDay;
    expiresOn: string;
  }> = [];

  for (const type of Object.keys(DOCUMENT_FIELDS) as DocumentType[]) {
    const field = DOCUMENT_FIELDS[type];
    const expiresOn = driver[field];
    if (!expiresOn) {
      continue;
    }

    const days = daysUntilExpiry(expiresOn, today);
    if ((REMINDER_DAYS as readonly number[]).includes(days)) {
      targets.push({
        type,
        daysBefore: days as ReminderDay,
        expiresOn: expiresOn.slice(0, 10),
      });
    }
  }

  return targets;
}

export const EXPIRED_DOCS_MESSAGE =
  "Uno o más de tus documentos están vencidos. Tu información fue guardada correctamente, pero no podrás recibir servicios hasta actualizar los documentos.";

export const BLOCKED_AVAILABILITY_MESSAGE =
  "No puedes quedar Disponible porque tienes documentos vencidos. Actualiza SOAT, tecnomecánica y/o licencia desde Mis datos.";

export function buildReminderMessage(
  driverName: string,
  type: DocumentType,
  daysBefore: ReminderDay,
  expiresOn: string,
): string {
  const label = DOCUMENT_LABELS[type];
  const [y, m, d] = expiresOn.split("-");
  const display = `${d}/${m}/${y}`;

  if (daysBefore === 1) {
    return `⏰ Hola ${driverName}, tu ${label} vence mañana (${display}). Actualízala a tiempo para seguir recibiendo servicios.`;
  }

  return `⏰ Hola ${driverName}, tu ${label} vence en ${daysBefore} días (${display}). Actualízala a tiempo para seguir recibiendo servicios.`;
}

export function buildExpiredBlockMessage(
  expired: DocumentType[],
): string {
  const labels = expired.map((type) => DOCUMENT_LABELS[type]).join(", ");
  return `⛔ Uno o más documentos vencieron (${labels}). Quedaste inactivo y no recibirás servicios hasta actualizarlos en Mis datos.`;
}

export function buildReactivatedMessage(): string {
  return "✅ Tus documentos quedaron al día. El bloqueo documental fue removido. Cuando quieras recibir servicios, actívate como Disponible desde tu menú.";
}
