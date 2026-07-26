"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "@/app/auth/auth.module.css";
import { isValidEmail } from "@/lib/auth/password-policy";
import { mapAuthErrorMessage } from "@/lib/auth/messages";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isValidEmail(email)) {
      setError("Ingresa un correo electrónico válido.");
      return;
    }
    if (!password) {
      setError("Ingresa tu contraseña.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(mapAuthErrorMessage(signInError));
        return;
      }

      setSuccess("Sesión iniciada correctamente.");
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
      {success ? (
        <div className={`${styles.alert} ${styles.alertOk}`} role="status">
          {success}
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
          />
        </label>

        <label className={styles.label}>
          Contraseña
          <input
            className={styles.input}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button className={styles.button} type="submit" disabled={loading}>
          {loading ? "Ingresando…" : "Iniciar sesión"}
        </button>
      </form>

      <div className={styles.footerLinks}>
        <Link className={styles.link} href="/forgot-password">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>
    </>
  );
}
