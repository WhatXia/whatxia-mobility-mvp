"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveBotOperationalStatus } from "@/app/ops/sistema/actions";
import styles from "@/app/ops/ops.module.css";
import type { BotOperationalStatus } from "@/lib/bot-operational-status/types";

type Props = {
  initial: BotOperationalStatus;
};

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SistemaDashboard({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initial.status);
  const [message, setMessage] = useState(initial.maintenanceMessage);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [meta, setMeta] = useState(initial);

  const isMaintenance = status === "MAINTENANCE";

  function onSave() {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveBotOperationalStatus({
        status,
        maintenanceMessage: message,
      });
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      setMeta(result.status);
      setStatus(result.status.status);
      setMessage(result.status.maintenanceMessage);
      setFeedback(
        result.status.status === "MAINTENANCE"
          ? "Bot en mantenimiento. Los usuarios solo reciben el mensaje configurado."
          : "Bot activo. Operación normal restaurada.",
      );
      router.refresh();
    });
  }

  return (
    <section className={styles.panel}>
      <p className={styles.breadcrumb}>
        Parámetros <span aria-hidden>/</span> Sistema{" "}
        <span aria-hidden>/</span> Estado del Bot
      </p>
      <h2 className={styles.panelTitle}>Estado del Bot</h2>
      <p className={styles.panelLead}>
        Activa o pon en mantenimiento el bot sin reiniciar servicios ni
        desplegar código. En mantenimiento no se ejecuta ningún flujo
        conversacional.
      </p>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Estado actual</span>
          <span className={styles.statValue}>
            {meta.status === "MAINTENANCE" ? "🟡" : "🟢"}
          </span>
          <span className={styles.statHint}>
            {meta.status === "MAINTENANCE" ? "Mantenimiento" : "Activo"}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Último cambio</span>
          <span className={styles.statHint}>{formatWhen(meta.updatedAt)}</span>
          <span className={styles.statHint}>
            {meta.updatedByEmail ?? "—"}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Código CMS</span>
          <span className={styles.statHint}>{meta.cmsMessageCode}</span>
          <span className={styles.statHint}>
            Editable también desde el CMS
          </span>
        </div>
      </div>

      <div className={styles.formCard}>
        <fieldset className={styles.fieldset} disabled={pending}>
          <legend className={styles.legend}>Interruptor</legend>
          <div className={styles.toggleRow}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${
                !isMaintenance ? styles.toggleBtnActive : ""
              }`}
              onClick={() => setStatus("ACTIVE")}
              aria-pressed={!isMaintenance}
            >
              🟢 Activo
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${
                isMaintenance ? styles.toggleBtnMaint : ""
              }`}
              onClick={() => setStatus("MAINTENANCE")}
              aria-pressed={isMaintenance}
            >
              🟡 Mantenimiento
            </button>
          </div>
        </fieldset>

        <label className={styles.fieldLabel} htmlFor="maintenance-message">
          Mensaje de mantenimiento
        </label>
        <textarea
          id="maintenance-message"
          className={styles.textarea}
          rows={5}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={pending}
        />
        <p className={styles.fieldHint}>
          Se envía a usuarios y conductores cuando el bot está en
          mantenimiento. Código CMS: <code>SYS_BOT_MAINTENANCE</code>.
        </p>

        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={onSave}
            disabled={pending}
          >
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
          {feedback ? (
            <span className={styles.bulkMsg} role="status">
              {feedback}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
