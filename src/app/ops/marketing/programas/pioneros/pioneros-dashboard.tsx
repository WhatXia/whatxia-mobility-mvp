"use client";

import Link from "next/link";
import styles from "@/app/ops/ops.module.css";
import type { CityLaunchAudit } from "@/lib/launch-programs/city-launch";
import type { LaunchProgramRuntime } from "@/lib/launch-programs/config";

type Props = {
  program: LaunchProgramRuntime | null;
  lastLaunch: CityLaunchAudit | null;
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

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function statusLabel(status: CityLaunchAudit["status"]): string {
  switch (status) {
    case "completed":
      return "Completado";
    case "partial":
      return "Parcial";
    case "failed":
      return "Fallido";
    case "in_progress":
      return "En curso";
    case "skipped":
      return "Omitido";
    default:
      return status;
  }
}

export function PionerosProgramDashboard({ program, lastLaunch }: Props) {
  const programActive = Boolean(program?.isActiveFlag);

  return (
    <section className={styles.panel}>
      <p className={styles.breadcrumb}>
        Marketing <span aria-hidden>/</span> Programas de Lanzamiento{" "}
        <span aria-hidden>/</span> Pioneros
      </p>
      <h2 className={styles.panelTitle}>Programa Pioneros</h2>
      <p className={styles.panelLead}>
        Estado del programa y auditoría del lanzamiento oficial de ciudad
        (PIONEERS-004). El cierre manual o automático ejecuta la misma función{" "}
        <code>closeLaunchProgram</code>.
      </p>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Programa</span>
          <span className={styles.statValue}>
            {programActive ? "🟢" : "⚪"}
          </span>
          <span className={styles.statHint}>
            {programActive ? "Activo" : "Inactivo"}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pioneros actuales</span>
          <strong className={styles.statValue}>
            {program?.registeredPioneers ?? 0}
          </strong>
          <span className={styles.statHint}>
            <Link href="/ops/users?status=PIONEER">Ver usuarios</Link>
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>CMS lanzamiento</span>
          <span className={styles.statHint}>CITY_LAUNCH_MESSAGE</span>
          <span className={styles.statHint}>Botón: 🚖 Solicitar servicio</span>
        </div>
      </div>

      <div className={styles.formCard}>
        <h3 className={styles.legend}>Último lanzamiento</h3>
        {!lastLaunch ? (
          <p className={styles.fieldHint}>
            Aún no se ha ejecutado el lanzamiento de ciudad para este programa.
          </p>
        ) : (
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Ciudad</span>
              <span className={styles.statHint}>{lastLaunch.cityName}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Fecha</span>
              <span className={styles.statHint}>
                {formatWhen(lastLaunch.startedAt)}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Usuarios activados</span>
              <strong className={styles.statValue}>
                {lastLaunch.usersActivated}
              </strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>WhatsApp enviados</span>
              <strong className={styles.statValue}>
                {lastLaunch.messagesSent}
              </strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Fallidos</span>
              <strong className={styles.statValue}>
                {lastLaunch.messagesFailed}
              </strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Duración</span>
              <span className={styles.statHint}>
                {formatDuration(lastLaunch.durationMs)}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Estado</span>
              <span className={styles.statHint}>
                {statusLabel(lastLaunch.status)}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Iniciado por</span>
              <span className={styles.statHint}>{lastLaunch.actorLabel}</span>
              <span className={styles.statHint}>
                {lastLaunch.triggerSource === "auto_end"
                  ? "automático"
                  : "manual"}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
