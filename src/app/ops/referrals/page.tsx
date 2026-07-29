import {
  fetchOpsReferralLeaders,
  fetchOpsReferralStats,
} from "@/app/ops/referrals/actions";
import { ReferralsDashboard } from "@/app/ops/referrals/referrals-dashboard";

export const metadata = {
  title: "Referidos | WhatXia Ops",
};

export default async function OpsReferralsPage() {
  const [stats, leaders] = await Promise.all([
    fetchOpsReferralStats(),
    fetchOpsReferralLeaders(),
  ]);

  return <ReferralsDashboard stats={stats} leaders={leaders} />;
}
