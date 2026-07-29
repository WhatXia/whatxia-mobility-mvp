import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import styles from "@/app/ops/ops.module.css";

export default async function OpsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/ops/users");
  }

  return (
    <div className={styles.shell}>
      <div className={styles.header}>
        <div>
          <p className={styles.brand}>WhatXia Operations</p>
          <h1 className={styles.title}>Centro de operaciones</h1>
          <p className={styles.subtitle}>Gestión de usuarios y referidos</p>
        </div>
        <nav className={styles.nav}>
          <Link href="/ops/users">Usuarios</Link>
          <Link href="/ops/referrals">Referidos</Link>
          <Link href="/login">Cuenta</Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
