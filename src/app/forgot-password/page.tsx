import styles from "@/app/auth/auth.module.css";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = {
  title: "Recuperar contraseña | WhatXia",
};

export default function ForgotPasswordPage() {
  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.brand}>WhatXia</p>
        <h1 className={styles.title}>Recuperar contraseña</h1>
        <p className={styles.subtitle}>
          Ingresa tu correo y te enviaremos un enlace para restablecerla.
        </p>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
