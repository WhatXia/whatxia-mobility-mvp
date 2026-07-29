import { Suspense } from "react";
import styles from "@/app/auth/auth.module.css";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Iniciar sesión | WhatXia",
};

export default function LoginPage() {
  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.brand}>WhatXia</p>
        <h1 className={styles.title}>Iniciar sesión</h1>
        <p className={styles.subtitle}>
          Accede con el correo registrado en WhatXia.
        </p>
        <Suspense fallback={<p>Cargando…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
