"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "@/app/auth/auth.module.css";
import {
  RECOVERY_REQUEST_CONFIRMATION,
  getSiteUrl,
  mapAuthErrorMessage,
} from "@/lib/auth/messages";
import { isValidEmail } from "@/lib/auth/password-policy";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmation(null);

    if (!isValidEmail(email)) {
      setError("Ingresa un correo electrónico válido.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const redirectTo = `${getSiteUrl()}/auth/confirm?next=/auth/reset-password`;

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo },
      );

      if (resetError) {
        const msg = (resetError.message ?? "").toLowerCase();
        if (msg.includes("fetch") || msg.includes("network")) {
          setError(mapAuthErrorMessage(resetError));
          return;
        }
        // No revelar si el correo existe: misma confirmación genérica.
      }

      setConfirmation(RECOVERY_REQUEST_CONFIRMATION);
    } catch {
      setError(mapAuthErrorMessage({ message: "network" }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {error ? (
        <div className={`${styles.alert} ${styles.alertError}`} role="alert">
          {error}
        </div>
      ) : null}
      {confirmation ? (
        <div className={`${styles.alert} ${styles.alertOk}`} role="status">
          {confirmation}
        </div>
      ) : null}

      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.label}>
          Correo electrónico
          <input
            className={styles.input}
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={Boolean(confirmation)}
          />
        </label>

        <button
          className={styles.button}
          type="submit"
          disabled={loading || Boolean(confirmation)}
        >
          {loading ? "Enviando…" : "Enviar enlace de recuperación"}
        </button>
      </form>

      <div className={styles.footerLinks}>
        <Link className={styles.link} href="/login">
          Volver al inicio de sesión
        </Link>
      </div>
    </>
  );
}
