import type { BookingDraft } from "@/lib/geo/types";

export type IncomingLocation = {
  lat: number;
  lng: number;
  name: string | null;
  address: string | null;
};

export type IncomingMessage = {
  phone: string;
  name: string;
  text: string | null;
  button: string | null;
  location: IncomingLocation | null;
};

export type DriverFieldCategory = "personal" | "vehicle" | "documents";

export type UserState =
  | "IDLE"
  | "WAITING_PICKUP"
  | "WAITING_PICKUP_LOCATION"
  | "WAITING_PICKUP_TEXT"
  | "WAITING_PICKUP_CONFIRM"
  | "WAITING_DROPOFF_TEXT"
  | "WAITING_DROPOFF_LOCATION"
  | "WAITING_DROPOFF_CONFIRM"
  | "WAITING_QUOTE_CONFIRM"
  | "SEARCHING_DRIVER"
  | "ASSIGNED"
  | "DRIVER_REGISTERING"
  | "DRIVER_REGISTRATION_WELCOME"
  | "DRIVER_REGISTRATION_PAUSED"
  | "DRIVER_REGISTRATION_RESUME_CHOICE"
  | "DRIVER_PASSWORD_CREATE"
  | "DRIVER_PASSWORD_CONFIRM"
  | "DRIVER_LOGIN_DOCUMENT"
  | "DRIVER_LOGIN_PASSWORD"
  | "DRIVER_UPDATE_CATEGORY"
  | "DRIVER_UPDATE_SELECT_FIELD"
  | "DRIVER_UPDATE_VALUE"
  | "DRIVER_UPDATE_EXPIRED_DOCS"
  // Compatibilidad con sesiones antiguas en memoria
  | "WAITING_DRIVER_NAME"
  | "WAITING_DRIVER_PLATE";

export type DriverDraft = Partial<{
  name: string;
  document_id: string;
  email: string;
  address: string;
  city: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  plate: string;
  vehicle_brand: string;
  vehicle_model: string;
  vehicle_color: string;
  vehicle_year: string;
  soat_expires_at: string;
  techno_expires_at: string;
  operation_expires_at: string;
  license_expires_at: string;
}>;

export type UserSession = {
  phone: string;
  name: string;
  state: UserState;
  pickupNeighborhood: string | null;
  driverName: string | null;
  driverDraft: DriverDraft | null;
  driverFlowStep: string | null;
  driverUpdateCategory: DriverFieldCategory | null;
  driverUpdateField: string | null;
  bookingDraft: BookingDraft | null;
};

export type { BookingDraft };
