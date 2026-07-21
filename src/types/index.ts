export type IncomingMessage = {
  phone: string;
  name: string;
  text: string | null;
  button: string | null;
};

export type UserState =
  | "IDLE"
  | "WAITING_PICKUP"
  | "SEARCHING_DRIVER"
  | "WAITING_DRIVER_NAME"
  | "WAITING_DRIVER_PLATE";

export type UserSession = {
  phone: string;
  name: string;
  state: UserState;
  pickupNeighborhood: string | null;
  driverName: string | null;
};
