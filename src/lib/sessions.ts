import type {
  DriverDraft,
  DriverFieldCategory,
  UserSession,
  UserState,
} from "@/types";

const sessions = new Map<string, UserSession>();

export function getSession(phone: string): UserSession | undefined {
  return sessions.get(phone);
}

export function upsertSession(
  phone: string,
  data: {
    name?: string;
    state: UserState;
    pickupNeighborhood?: string | null;
    driverName?: string | null;
    driverDraft?: DriverDraft | null;
    driverFlowStep?: string | null;
    driverUpdateCategory?: DriverFieldCategory | null;
    driverUpdateField?: string | null;
  },
): UserSession {
  const current = sessions.get(phone);

  const session: UserSession = {
    phone,
    name: data.name ?? current?.name ?? "",
    state: data.state,
    pickupNeighborhood:
      data.pickupNeighborhood !== undefined
        ? data.pickupNeighborhood
        : (current?.pickupNeighborhood ?? null),
    driverName:
      data.driverName !== undefined
        ? data.driverName
        : (current?.driverName ?? null),
    driverDraft:
      data.driverDraft !== undefined
        ? data.driverDraft
        : (current?.driverDraft ?? null),
    driverFlowStep:
      data.driverFlowStep !== undefined
        ? data.driverFlowStep
        : (current?.driverFlowStep ?? null),
    driverUpdateCategory:
      data.driverUpdateCategory !== undefined
        ? data.driverUpdateCategory
        : (current?.driverUpdateCategory ?? null),
    driverUpdateField:
      data.driverUpdateField !== undefined
        ? data.driverUpdateField
        : (current?.driverUpdateField ?? null),
  };

  sessions.set(phone, session);
  return session;
}

export function clearSession(phone: string): void {
  sessions.delete(phone);
}
