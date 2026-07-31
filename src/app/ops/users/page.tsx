import {
  fetchOpsPassengerCounts,
  fetchOpsPassengers,
} from "@/app/ops/users/actions";
import { UsersDashboard } from "@/app/ops/users/users-dashboard";
import { isPassengerStatus } from "@/lib/passenger-status";
import {
  getLaunchProgramRuntime,
  PIONEERS_USERS_CODE,
} from "@/lib/launch-programs/config";
import type { ListPassengersFilter } from "@/lib/supabase/passengers";

export const metadata = {
  title: "Usuarios | WhatXia Ops",
};

type PageProps = {
  searchParams: Promise<{ status?: string; q?: string }>;
};

function resolveFilter(raw?: string): ListPassengersFilter {
  if (!raw || raw === "all") return "all";
  if (isPassengerStatus(raw)) return raw;
  return "all";
}

export default async function OpsUsersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = resolveFilter(params.status);
  const query = params.q?.trim() ?? "";
  const [users, counts, program] = await Promise.all([
    fetchOpsPassengers({ status: filter, query }),
    fetchOpsPassengerCounts(),
    getLaunchProgramRuntime(PIONEERS_USERS_CODE, { bypassCache: true }),
  ]);

  return (
    <UsersDashboard
      users={users}
      counts={counts}
      filter={filter}
      initialQuery={query}
      preLaunch={Boolean(program?.acceptsNewPioneers)}
      programActive={Boolean(program?.isActiveFlag)}
    />
  );
}
