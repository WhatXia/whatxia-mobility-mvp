import { catalogBody, cmsSync } from "@/lib/bot-cms/copy";

function driverFieldCode(key: DriverFieldKey): string {
  return `D_FIELD_${key.toUpperCase()}`;
}

export type DriverFieldKey =
  | "name"
  | "document_id"
  | "email"
  | "address"
  | "city"
  | "emergency_contact_name"
  | "emergency_contact_phone"
  | "plate"
  | "vehicle_brand"
  | "vehicle_model"
  | "vehicle_color"
  | "vehicle_year"
  | "soat_expires_at"
  | "techno_expires_at"
  | "operation_expires_at"
  | "license_expires_at";

export type DriverFieldCategory = "personal" | "vehicle" | "documents";

export type DriverFieldDef = {
  key: DriverFieldKey;
  label: string;
  prompt: string;
  category: DriverFieldCategory;
  type: "text" | "phone" | "year" | "date";
};

export const DRIVER_FIELDS: Record<DriverFieldKey, DriverFieldDef> = {
  name: {
    key: "name",
    label: "Nombre completo",
    prompt: catalogBody(driverFieldCode("name")),
    category: "personal",
    type: "text",
  },
  document_id: {
    key: "document_id",
    label: "Número de cédula",
    prompt: catalogBody(driverFieldCode("document_id")),
    category: "personal",
    type: "text",
  },
  email: {
    key: "email",
    label: "Correo electrónico",
    prompt: catalogBody(driverFieldCode("email")),
    category: "personal",
    type: "text",
  },
  address: {
    key: "address",
    label: "Dirección de residencia",
    prompt: catalogBody(driverFieldCode("address")),
    category: "personal",
    type: "text",
  },
  city: {
    key: "city",
    label: "Ciudad",
    prompt: catalogBody(driverFieldCode("city")),
    category: "personal",
    type: "text",
  },
  // Conservados para perfiles / actualizaciones existentes; fuera del registro.
  emergency_contact_name: {
    key: "emergency_contact_name",
    label: "Contacto de emergencia",
    prompt: catalogBody(driverFieldCode("emergency_contact_name")),
    category: "personal",
    type: "text",
  },
  emergency_contact_phone: {
    key: "emergency_contact_phone",
    label: "Tel. emergencia",
    prompt: catalogBody(driverFieldCode("emergency_contact_phone")),
    category: "personal",
    type: "phone",
  },
  plate: {
    key: "plate",
    label: "Placa del vehículo",
    prompt: catalogBody(driverFieldCode("plate")),
    category: "vehicle",
    type: "text",
  },
  vehicle_brand: {
    key: "vehicle_brand",
    label: "Marca del vehículo",
    prompt: catalogBody(driverFieldCode("vehicle_brand")),
    category: "vehicle",
    type: "text",
  },
  vehicle_model: {
    key: "vehicle_model",
    label: "Línea o referencia",
    prompt: catalogBody(driverFieldCode("vehicle_model")),
    category: "vehicle",
    type: "text",
  },
  vehicle_color: {
    key: "vehicle_color",
    label: "Color del vehículo",
    prompt: catalogBody(driverFieldCode("vehicle_color")),
    category: "vehicle",
    type: "text",
  },
  // Conservado para perfiles / actualizaciones existentes; fuera del registro.
  vehicle_year: {
    key: "vehicle_year",
    label: "Año",
    prompt: catalogBody(driverFieldCode("vehicle_year")),
    category: "vehicle",
    type: "year",
  },
  soat_expires_at: {
    key: "soat_expires_at",
    label: "Vence SOAT",
    prompt: catalogBody(driverFieldCode("soat_expires_at")),
    category: "documents",
    type: "date",
  },
  techno_expires_at: {
    key: "techno_expires_at",
    label: "Vence técnico-mecánica",
    prompt: catalogBody(driverFieldCode("techno_expires_at")),
    category: "documents",
    type: "date",
  },
  operation_expires_at: {
    key: "operation_expires_at",
    label: "Vence tarjeta de operación",
    prompt: catalogBody(driverFieldCode("operation_expires_at")),
    category: "documents",
    type: "date",
  },
  license_expires_at: {
    key: "license_expires_at",
    label: "Vence licencia de tránsito",
    prompt: catalogBody(driverFieldCode("license_expires_at")),
    category: "documents",
    type: "date",
  },
};

/** Orden del registro completo (el teléfono sale de WhatsApp). */
export const REGISTRATION_ORDER: DriverFieldKey[] = [
  "document_id",
  "name",
  "email",
  "address",
  "city",
  "plate",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_color",
  "soat_expires_at",
  "techno_expires_at",
  "operation_expires_at",
  "license_expires_at",
];

export const CATEGORY_FIELDS: Record<DriverFieldCategory, DriverFieldKey[]> = {
  personal: ["email", "address", "city"],
  vehicle: ["plate", "vehicle_brand", "vehicle_model", "vehicle_color"],
  documents: [
    "soat_expires_at",
    "techno_expires_at",
    "operation_expires_at",
    "license_expires_at",
  ],
};

/** Opciones del menú Datos personales (DRIVER-004): lectura / editable / WhatsApp. */
export type PersonalUpdateOption =
  | { kind: "readonly"; key: "document_id" | "name" }
  | { kind: "editable"; key: "email" | "address" | "city" }
  | { kind: "whatsapp" };

export const PERSONAL_UPDATE_OPTIONS: PersonalUpdateOption[] = [
  { kind: "readonly", key: "document_id" },
  { kind: "readonly", key: "name" },
  { kind: "editable", key: "email" },
  { kind: "editable", key: "address" },
  { kind: "editable", key: "city" },
  { kind: "whatsapp" },
];

export type DriverDraft = Partial<Record<DriverFieldKey, string>>;

export function parseDriverDate(input: string): string | null {
  const value = input.trim();

  const dmy = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const ymd = value.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 2000 || year > 2100) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatDateForDisplay(isoDate: string | null | undefined): string {
  if (!isoDate) {
    return "—";
  }

  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return isoDate;
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function validateDriverField(
  key: DriverFieldKey,
  raw: string,
): { ok: true; value: string | number } | { ok: false; error: string } {
  const field = DRIVER_FIELDS[key];
  const trimmed = raw.trim();

  if (!trimmed) {
    return { ok: false, error: catalogBody("D_FIELD_ERROR_REQUIRED") };
  }

  if (field.type === "date") {
    const iso = parseDriverDate(trimmed);
    if (!iso) {
      return {
        ok: false,
        error: catalogBody("D_FIELD_ERROR_DATE"),
      };
    }
    return { ok: true, value: iso };
  }

  if (field.type === "year") {
    const year = Number(trimmed);
    const current = new Date().getFullYear();
    if (!Number.isInteger(year) || year < 1980 || year > current + 1) {
      return {
        ok: false,
        error: cmsSync("D_FIELD_ERROR_YEAR", {
          max_year: String(current + 1),
        }),
      };
    }
    return { ok: true, value: year };
  }

  if (field.type === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 10) {
      return {
        ok: false,
        error: catalogBody("D_FIELD_ERROR_PHONE"),
      };
    }
    return { ok: true, value: digits };
  }

  if (key === "document_id") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 5) {
      return {
        ok: false,
        error: catalogBody("D_FIELD_ERROR_DOCUMENT"),
      };
    }
    return { ok: true, value: digits };
  }

  if (key === "plate") {
    return { ok: true, value: trimmed.toUpperCase().replace(/\s+/g, "") };
  }

  return { ok: true, value: trimmed };
}

export function nextRegistrationStep(
  current: DriverFieldKey | null,
): DriverFieldKey | null {
  if (!current) {
    return REGISTRATION_ORDER[0] ?? null;
  }

  const index = REGISTRATION_ORDER.indexOf(current);
  if (index < 0 || index >= REGISTRATION_ORDER.length - 1) {
    return null;
  }

  return REGISTRATION_ORDER[index + 1] ?? null;
}
