"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import styles from "@/app/auth/auth.module.css";
import {
  PASSWORD_UPDATED_CONFIRMATION,
  mapAuthErrorMessage,
} from "@/lib/auth/messages";
import { getPasswordValidationError } from "@/lib/auth/password-policy";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type SessionState = "checking" | "ready" | "missing";

export function ResetPasswordForm() {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let active = true;

    async function ensureRecoverySession() {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      if (sessionError) {
        setSessionState("missing");
        return;
      }
      if (data.session) {
        setSessionState("ready");
        return;
      }
      setSessionState("missing");
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setSessionState("ready");
      }
    });

    void ensureRecoverySession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const policyError = getPasswordValidationError(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(mapAuthErrorMessage(updateError));
        return;
      }

      setSuccess(PASSWORD_UPDATED_CONFIRMATION);
      await supabase.auth.signOut();

      window.setTimeout(() => {
        router.push("/login");
      }, 1600);
    } catch {
      setError(mapAuthErrorMessage({ message: "network" }));
    } finally {
      setLoading(false);
    }
  }

  if (sessionState === "checking") {
    return (
      <div className={`${styles.alert} ${styles.alertInfo}`} role="status">
        Validando enlace de recuperación…
      </div>
    );
  }

  if (sessionState === "missing") {
    return (
      <>
        <div className={`${styles.alert} ${styles.alertError}`} role="alert">
          El enlace de recuperación no es válido, expiró o ya fue utilizado.
        </div>
        <div className={styles.footerLinks}>
          <Link className={styles.link} href="/forgot-password">
            Solicitar nuevo enlace
          </Link>
          <Link className={styles.link} href="/login">
            Volver al inicio de sesión
          </Link>
        </div>
      </>
    );
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
          Nueva contraseña
          <input
            className={styles.input}
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={Boolean(success)}
          />
        </label>

        <label className={styles.label}>
          Confirmar contraseña
          <input
            className={styles.input}
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            disabled={Boolean(success)}
          />
        </label>

        <button
          className={styles.button}
          type="submit"
          disabled={loading || Boolean(success)}
        >
          {loading ? "Actualizando…" : "Guardar contraseña"}
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
