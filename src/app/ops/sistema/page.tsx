import { Suspense } from "react";
import { fetchBotOperationalStatus } from "@/app/ops/sistema/actions";
import { SistemaDashboard } from "@/app/ops/sistema/sistema-dashboard";

export const metadata = {
  title: "Estado del Bot | WhatXia Ops",
};

export default async function OpsSistemaPage() {
  const status = await fetchBotOperationalStatus();

  return (
    <Suspense fallback={<p>Cargando…</p>}>
      <SistemaDashboard initial={status} />
    </Suspense>
  );
}
