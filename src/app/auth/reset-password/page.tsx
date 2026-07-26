import styles from "@/app/auth/auth.module.css";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: "Nueva contraseña | WhatXia",
};

export default function ResetPasswordPage() {
  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.brand}>WhatXia</p>
        <h1 className={styles.title}>Restablecer contraseña</h1>
        <p className={styles.subtitle}>
          Elige una nueva contraseña para tu cuenta WhatXia.
        </p>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
