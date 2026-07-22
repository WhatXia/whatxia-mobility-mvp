import { getSupabase } from "@/lib/supabase/client";
import type { DriverDraft, DriverFieldKey } from "@/lib/driver-profile-fields";
import { hasExpiredDocuments } from "@/lib/driver-documents";
import { normalizePhone, samePhone } from "@/lib/trips";
import { getActiveCity } from "@/lib/city/context";

export type DriverStatus = "active" | "inactive";

export type DriverRow = {
  id: string;
  phone: string;
  name: string;
  plate: string;
  document_id: string | null;
  address: string | null;
  city: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  vehicle_brand: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  soat_expires_at: string | null;
  techno_expires_at: string | null;
  license_expires_at: string | null;
  is_available: boolean;
  status: DriverStatus;
  documents_blocked: boolean;
  documents_blocked_reason: string | null;
  documents_reminder_sent_at: string | null;
  cancel_policy_count: number;
  suspended_until: string | null;
  city_id: string | null;
  created_at: string;
};

const DRIVER_COLUMNS = "*";

export async function findDriverByPhone(
  phone: string,
): Promise<DriverRow | null> {
  const supabase = getSupabase();
  const normalized = normalizePhone(phone);

  const { data, error } = await supabase
    .from("drivers")
    .select(DRIVER_COLUMNS)
    .eq("phone", normalized)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al buscar conductor:", error);
    throw error;
  }

  if (data) {
    return data as DriverRow;
  }

  if (phone !== normalized) {
    const { data: legacy, error: legacyError } = await supabase
      .from("drivers")
      .select(DRIVER_COLUMNS)
      .eq("phone", phone)
      .maybeSingle();

    if (legacyError) {
      console.error(
        "[supabase] error al buscar conductor (legacy):",
        legacyError,
      );
      throw legacyError;
    }

    return legacy as DriverRow | null;
  }

  return null;
}

export async function listAvailableDrivers(options?: {
  excludePhone?: string;
  excludeDriverId?: string;
}): Promise<DriverRow[]> {
  const supabase = getSupabase();
  const city = await getActiveCity();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("drivers")
    .select(DRIVER_COLUMNS)
    .eq("is_available", true)
    .eq("documents_blocked", false)
    .eq("status", "active")
    .eq("city_id", city.id);

  if (error) {
    console.error("[supabase] error al listar conductores:", error);
    throw error;
  }

  const drivers = (data ?? []) as DriverRow[];
  const eligible: DriverRow[] = [];

  for (const driver of drivers) {
    if (options?.excludeDriverId && driver.id === options.excludeDriverId) {
      continue;
    }

    if (
      options?.excludePhone &&
      samePhone(driver.phone, options.excludePhone)
    ) {
      continue;
    }

    if (
      driver.suspended_until &&
      new Date(driver.suspended_until).getTime() > Date.now()
    ) {
      continue;
    }

    // Reactivación automática: limpiar suspensión vencida.
    if (
      driver.suspended_until &&
      new Date(driver.suspended_until).getTime() <= Date.now()
    ) {
      await supabase
        .from("drivers")
        .update({ suspended_until: null })
        .eq("id", driver.id)
        .lte("suspended_until", nowIso);
      driver.suspended_until = null;
    }

    eligible.push(driver);
  }

  return eligible;
}

export async function markDriverUnavailable(driverId: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: false })
    .eq("id", driverId)
    .eq("is_available", true)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar no disponible:", error);
    throw error;
  }

  return data !== null;
}

export async function markDriverAvailable(driverId: string): Promise<boolean> {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  // Limpia suspensión vencida antes de liberar.
  await supabase
    .from("drivers")
    .update({ suspended_until: null })
    .eq("id", driverId)
    .not("suspended_until", "is", null)
    .lte("suspended_until", nowIso);

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: true })
    .eq("id", driverId)
    .eq("documents_blocked", false)
    .eq("status", "active")
    .or(`suspended_until.is.null,suspended_until.lte.${nowIso}`)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al marcar disponible:", error);
    throw error;
  }

  return data !== null;
}

export async function setDriverAvailability(
  driverId: string,
  isAvailable: boolean,
): Promise<DriverRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ is_available: isAvailable })
    .eq("id", driverId)
    .select(DRIVER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al actualizar disponibilidad:", error);
    throw error;
  }

  return data as DriverRow | null;
}

export type CreateDriverInput = {
  phone: string;
  name: string;
  plate: string;
  document_id: string;
  address: string;
  city: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_year: number;
  soat_expires_at: string;
  techno_expires_at: string;
  license_expires_at: string;
};

export async function createDriver(
  input: CreateDriverInput,
): Promise<{ driver: DriverRow; documentsExpired: boolean }> {
  const supabase = getSupabase();
  const city = await getActiveCity();
  const documentsExpired = hasExpiredDocuments(input);

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      phone: normalizePhone(input.phone),
      name: input.name,
      plate: input.plate,
      document_id: input.document_id,
      address: input.address,
      city: input.city,
      city_id: city.id,
      emergency_contact_name: input.emergency_contact_name,
      emergency_contact_phone: input.emergency_contact_phone,
      vehicle_brand: input.vehicle_brand,
      vehicle_model: input.vehicle_model,
      vehicle_color: input.vehicle_color,
      vehicle_year: input.vehicle_year,
      soat_expires_at: input.soat_expires_at,
      techno_expires_at: input.techno_expires_at,
      license_expires_at: input.license_expires_at,
      is_available: !documentsExpired,
      status: documentsExpired ? "inactive" : "active",
      documents_blocked: documentsExpired,
      documents_blocked_reason: documentsExpired
        ? "Documentos vencidos al registrar"
        : null,
    })
    .select(DRIVER_COLUMNS)
    .single();

  if (error) {
    console.error("[supabase] error al crear conductor:", error);
    throw error;
  }

  return {
    driver: data as DriverRow,
    documentsExpired,
  };
}

export async function updateDriverField(
  driverId: string,
  field: DriverFieldKey,
  value: string | number,
): Promise<DriverRow | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .update({ [field]: value })
    .eq("id", driverId)
    .select(DRIVER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[supabase] error al actualizar conductor:", error);
    throw error;
  }

  return data as DriverRow | null;
}

export function draftToCreateInput(
  phone: string,
  draft: DriverDraft,
): CreateDriverInput | null {
  const required: DriverFieldKey[] = [
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

  for (const key of required) {
    if (draft[key] === undefined || draft[key] === "") {
      return null;
    }
  }

  return {
    phone,
    name: draft.name!,
    plate: draft.plate!,
    document_id: draft.document_id!,
    address: draft.address!,
    city: draft.city!,
    emergency_contact_name: draft.emergency_contact_name!,
    emergency_contact_phone: draft.emergency_contact_phone!,
    vehicle_brand: draft.vehicle_brand!,
    vehicle_model: draft.vehicle_model!,
    vehicle_color: draft.vehicle_color!,
    vehicle_year: Number(draft.vehicle_year),
    soat_expires_at: draft.soat_expires_at!,
    techno_expires_at: draft.techno_expires_at!,
    license_expires_at: draft.license_expires_at!,
  };
}
