import { fetchPioneersProgramPage } from "@/app/ops/marketing/programas/pioneros/actions";
import { PionerosProgramDashboard } from "@/app/ops/marketing/programas/pioneros/pioneros-dashboard";

export const metadata = {
  title: "Pioneros | WhatXia Ops",
};

export default async function OpsPionerosProgramPage() {
  const { program, lastLaunch } = await fetchPioneersProgramPage();
  return (
    <PionerosProgramDashboard program={program} lastLaunch={lastLaunch} />
  );
}
