import Link from "next/link";
import styles from "@/app/auth/auth.module.css";

type AuthErrorPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

function messageForReason(reason?: string): string {
  switch (reason) {
    case "expired":
      return "El enlace de recuperación expiró. Solicita uno nuevo para continuar.";
    case "network":
      return "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
    case "session":
      return "No hay una sesión de recuperación activa. Solicita un nuevo enlace.";
    default:
      return "El enlace de recuperación no es válido o ya fue utilizado. Solicita uno nuevo.";
  }
}

export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const params = await searchParams;
  const message = messageForReason(params.reason);

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.brand}>WhatXia</p>
        <h1 className={styles.title}>No se pudo continuar</h1>
        <p className={styles.subtitle}>{message}</p>
        <div className={styles.footerLinks}>
          <Link className={styles.link} href="/forgot-password">
            Solicitar nuevo enlace
          </Link>
          <Link className={styles.link} href="/login">
            Volver al inicio de sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
