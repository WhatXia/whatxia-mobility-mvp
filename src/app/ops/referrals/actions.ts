"use server";

import {
  getOpsReferralProgramStats,
  listOpsReferralLeaders,
  type OpsReferralLeaderRow,
  type OpsReferralProgramStats,
} from "@/lib/referrals";

export async function fetchOpsReferralStats(): Promise<OpsReferralProgramStats> {
  return getOpsReferralProgramStats();
}

export async function fetchOpsReferralLeaders(): Promise<OpsReferralLeaderRow[]> {
  return listOpsReferralLeaders(40);
}
