import {
  fetchOpsPassengerCounts,
  fetchOpsPassengers,
} from "@/app/ops/users/actions";
import { UsersDashboard } from "@/app/ops/users/users-dashboard";
import {
  isPassengerStatus,
  isPreLaunchMode,
} from "@/lib/passenger-status";
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
  const [users, counts] = await Promise.all([
    fetchOpsPassengers({ status: filter, query }),
    fetchOpsPassengerCounts(),
  ]);

  return (
    <UsersDashboard
      users={users}
      counts={counts}
      filter={filter}
      initialQuery={query}
      preLaunch={isPreLaunchMode()}
    />
  );
}
