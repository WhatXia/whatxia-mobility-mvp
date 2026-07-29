"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getPassengerStatusCounts,
  listPassengers,
  updatePassengerStatus,
  updatePassengersStatusBulk,
  type ListPassengersFilter,
} from "@/lib/supabase/passengers";
import {
  isPassengerStatus,
  type PassengerStatus,
} from "@/lib/passenger-status";

async function requireOpsUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Error("No autorizado");
  }
  return user;
}

export async function fetchOpsPassengers(options?: {
  status?: ListPassengersFilter;
  query?: string;
}) {
  await requireOpsUser();
  return listPassengers({
    status: options?.status ?? "all",
    query: options?.query,
    limit: 500,
  });
}

export async function fetchOpsPassengerCounts() {
  await requireOpsUser();
  return getPassengerStatusCounts();
}

export async function invitePassengerToBeta(passengerId: string) {
  await requireOpsUser();
  const updated = await updatePassengerStatus(passengerId, "BETA");
  revalidatePath("/ops/users");
  return updated;
}

export async function invitePassengersToBetaBulk(passengerIds: string[]) {
  await requireOpsUser();
  const unique = Array.from(new Set(passengerIds)).slice(0, 20);
  if (unique.length === 0) {
    return { updated: 0 };
  }

  // Solo PIONEER → BETA (evita tocar otros estados por error de selección).
  const pioneers = await listPassengers({ status: "PIONEER", limit: 1000 });
  const pioneerIds = new Set(pioneers.map((p) => p.id));
  const toUpdate = unique.filter((id) => pioneerIds.has(id));
  const updated = await updatePassengersStatusBulk(toUpdate, "BETA");
  revalidatePath("/ops/users");
  return { updated };
}

export async function activatePassenger(passengerId: string) {
  await requireOpsUser();
  const updated = await updatePassengerStatus(passengerId, "ACTIVE");
  revalidatePath("/ops/users");
  return updated;
}

export async function blockPassenger(passengerId: string) {
  await requireOpsUser();
  const updated = await updatePassengerStatus(passengerId, "BLOCKED");
  revalidatePath("/ops/users");
  return updated;
}

export async function setPassengerStatusAction(
  passengerId: string,
  status: string,
) {
  await requireOpsUser();
  if (!isPassengerStatus(status)) {
    throw new Error("Status inválido");
  }
  const updated = await updatePassengerStatus(
    passengerId,
    status as PassengerStatus,
  );
  revalidatePath("/ops/users");
  return updated;
}
