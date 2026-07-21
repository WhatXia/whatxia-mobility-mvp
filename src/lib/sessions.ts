import type { UserSession, UserState } from "@/types";

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
  };

  sessions.set(phone, session);
  return session;
}

export function clearSession(phone: string): void {
  sessions.delete(phone);
}
