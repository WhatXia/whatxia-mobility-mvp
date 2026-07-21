export type DriverFieldKey =
  | "name"
  | "document_id"
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
    prompt: "Escribe tu nombre completo.",
    category: "personal",
    type: "text",
  },
  document_id: {
    key: "document_id",
    label: "Cédula",
    prompt: "Escribe tu número de cédula (solo números).",
    category: "personal",
    type: "text",
  },
  address: {
    key: "address",
    label: "Dirección",
    prompt: "Escribe tu dirección de residencia.",
    category: "personal",
    type: "text",
  },
  city: {
    key: "city",
    label: "Ciudad",
    prompt: "Escribe tu ciudad.",
    category: "personal",
    type: "text",
  },
  emergency_contact_name: {
    key: "emergency_contact_name",
    label: "Contacto de emergencia",
    prompt: "Escribe el nombre de tu contacto de emergencia.",
    category: "personal",
    type: "text",
  },
  emergency_contact_phone: {
    key: "emergency_contact_phone",
    label: "Tel. emergencia",
    prompt: "Escribe el teléfono de tu contacto de emergencia (con indicativo).",
    category: "personal",
    type: "phone",
  },
  plate: {
    key: "plate",
    label: "Placa",
    prompt: "Escribe la placa del vehículo.",
    category: "vehicle",
    type: "text",
  },
  vehicle_brand: {
    key: "vehicle_brand",
    label: "Marca",
    prompt: "Escribe la marca del vehículo.",
    category: "vehicle",
    type: "text",
  },
  vehicle_model: {
    key: "vehicle_model",
    label: "Modelo",
    prompt: "Escribe el modelo del vehículo.",
    category: "vehicle",
    type: "text",
  },
  vehicle_color: {
    key: "vehicle_color",
    label: "Color",
    prompt: "Escribe el color del vehículo.",
    category: "vehicle",
    type: "text",
  },
  vehicle_year: {
    key: "vehicle_year",
    label: "Año",
    prompt: "Escribe el año del vehículo (ej: 2018).",
    category: "vehicle",
    type: "year",
  },
  soat_expires_at: {
    key: "soat_expires_at",
    label: "Vence SOAT",
    prompt: "Escribe la fecha de vencimiento del SOAT (DD/MM/AAAA).",
    category: "documents",
    type: "date",
  },
  techno_expires_at: {
    key: "techno_expires_at",
    label: "Vence tecnomecánica",
    prompt:
      "Escribe la fecha de vencimiento de la revisión tecnomecánica (DD/MM/AAAA).",
    category: "documents",
    type: "date",
  },
  license_expires_at: {
    key: "license_expires_at",
    label: "Vence licencia",
    prompt: "Escribe la fecha de vencimiento de tu licencia (DD/MM/AAAA).",
    category: "documents",
    type: "date",
  },
};

/** Orden del registro completo (el teléfono sale de WhatsApp). */
export const REGISTRATION_ORDER: DriverFieldKey[] = [
  "name",
  "document_id",
  "address",
  "city",
  "emergency_contact_name",
  "emergency_contact_phone",
  "plate",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_color",
  "vehicle_year",
  "soat_expires_at",
  "techno_expires_at",
  "license_expires_at",
];

export const CATEGORY_FIELDS: Record<DriverFieldCategory, DriverFieldKey[]> = {
  personal: [
    "name",
    "document_id",
    "address",
    "city",
    "emergency_contact_name",
    "emergency_contact_phone",
  ],
  vehicle: [
    "plate",
    "vehicle_brand",
    "vehicle_model",
    "vehicle_color",
    "vehicle_year",
  ],
  documents: ["soat_expires_at", "techno_expires_at", "license_expires_at"],
};

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
    return { ok: false, error: "Este campo es obligatorio. Intenta de nuevo." };
  }

  if (field.type === "date") {
    const iso = parseDriverDate(trimmed);
    if (!iso) {
      return {
        ok: false,
        error: "Fecha inválida. Usa el formato DD/MM/AAAA.",
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
        error: `Año inválido. Usa un año entre 1980 y ${current + 1}.`,
      };
    }
    return { ok: true, value: year };
  }

  if (field.type === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 10) {
      return {
        ok: false,
        error: "Teléfono inválido. Incluye indicativo y número.",
      };
    }
    return { ok: true, value: digits };
  }

  if (key === "document_id") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 5) {
      return {
        ok: false,
        error: "Número de cédula inválido.",
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
