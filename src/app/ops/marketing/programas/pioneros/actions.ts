"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  getLatestCityLaunch,
  type CityLaunchAudit,
} from "@/lib/launch-programs/city-launch";
import {
  getLaunchProgramRuntime,
  PIONEERS_USERS_CODE,
  type LaunchProgramRuntime,
} from "@/lib/launch-programs/config";

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

export async function fetchPioneersProgramPage(): Promise<{
  program: LaunchProgramRuntime | null;
  lastLaunch: CityLaunchAudit | null;
}> {
  await requireOpsUser();
  const [program, lastLaunch] = await Promise.all([
    getLaunchProgramRuntime(PIONEERS_USERS_CODE, { bypassCache: true }),
    getLatestCityLaunch(PIONEERS_USERS_CODE),
  ]);
  return { program, lastLaunch };
}
