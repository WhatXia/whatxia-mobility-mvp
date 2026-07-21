export type IncomingMessage = {
  phone: string;
  name: string;
  text: string | null;
  button: string | null;
};

export type DriverFieldCategory = "personal" | "vehicle" | "documents";

export type UserState =
  | "IDLE"
  | "WAITING_PICKUP"
  | "SEARCHING_DRIVER"
  | "ASSIGNED"
  | "DRIVER_REGISTERING"
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
};
