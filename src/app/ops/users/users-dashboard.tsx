"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  activatePassenger,
  blockPassenger,
  deactivatePioneersProgramAction,
  invitePassengerToBeta,
  invitePassengersToBetaBulk,
} from "@/app/ops/users/actions";
import styles from "@/app/ops/ops.module.css";
import type { PassengerStatus } from "@/lib/passenger-status";
import {
  REGISTRATION_SOURCE_LABELS,
  type RegistrationSource,
} from "@/lib/registration-source";
import type {
  ListPassengersFilter,
  PassengerRow,
  PassengerStatusCounts,
} from "@/lib/supabase/passengers";

const MAX_BULK_BETA = 20;

type Props = {
  users: PassengerRow[];
  counts: PassengerStatusCounts;
  filter: ListPassengersFilter;
  initialQuery: string;
  preLaunch: boolean;
  /** is_active en DB (puede diferir de acceptsNewPioneers si ya venció ends_at). */
  programActive: boolean;
};

function badgeClass(status: PassengerStatus, stylesMap: typeof styles): string {
  switch (status) {
    case "PIONEER":
      return `${stylesMap.badge} ${stylesMap.badgePIONEER}`;
    case "BETA":
      return `${stylesMap.badge} ${stylesMap.badgeBETA}`;
    case "ACTIVE":
      return `${stylesMap.badge} ${stylesMap.badgeACTIVE}`;
    case "BLOCKED":
      return `${stylesMap.badge} ${stylesMap.badgeBLOCKED}`;
    default:
      return stylesMap.badge;
  }
}

function sourceLabel(source: RegistrationSource | null): string {
  if (!source) return "—";
  return REGISTRATION_SOURCE_LABELS[source];
}

function formatRegisteredAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UsersDashboard({
  users,
  counts,
  filter,
  initialQuery,
  preLaunch,
  programActive,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const pioneers = useMemo(
    () => users.filter((u) => u.status === "PIONEER"),
    [users],
  );

  const selectedPioneers = selected.filter((id) =>
    pioneers.some((p) => p.id === id),
  );

  function toggle(id: string, status: PassengerStatus) {
    if (status !== "PIONEER") return;
    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= MAX_BULK_BETA) {
        setMessage(`Máximo ${MAX_BULK_BETA} pioneros por lote.`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function toggleAllVisiblePioneers() {
    const ids = pioneers.slice(0, MAX_BULK_BETA).map((p) => p.id);
    setSelected(ids);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    router.push(qs ? `/ops/users?${qs}` : "/ops/users");
  }

  function runBulkBeta() {
    if (selectedPioneers.length === 0) {
      setMessage("Selecciona al menos un pionero.");
      return;
    }
    startTransition(async () => {
      const result = await invitePassengersToBetaBulk(selectedPioneers);
      setSelected([]);
      setMessage(`Enviados a Beta: ${result.updated}`);
      router.refresh();
    });
  }

  const filters: Array<{ id: ListPassengersFilter; label: string }> = [
    { id: "all", label: "Todos" },
    { id: "PIONEER", label: "Pioneros" },
    { id: "BETA", label: "Beta" },
    { id: "ACTIVE", label: "Activos" },
    { id: "BLOCKED", label: "Bloqueados" },
  ];

  function deactivateProgram() {
    setMessage(null);
    startTransition(async () => {
      const result = await deactivatePioneersProgramAction();
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const r = result.result;
      setMessage(
        r.alreadyLaunched
          ? "El lanzamiento de ciudad ya se había ejecutado (sin reenvío)."
          : `Programa cerrado + lanzamiento ciudad. Activados: ${r.activatedCount}. WhatsApp: ${r.messagesSent} ok / ${r.messagesFailed} fallidos.`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <div className={styles.flag}>
        Programa Pioneros:{" "}
        <strong>{preLaunch ? "activo" : "inactivo"}</strong>
        {preLaunch
          ? " — usuarios nuevos → PIONEER (launch_programs.is_active)"
          : " — usuarios nuevos → ACTIVE (programa desactivado; BOT-001)"}
        {programActive ? (
          <>
            {" · "}
            <button
              type="button"
              className={styles.actionBtn}
              disabled={pending}
              onClick={deactivateProgram}
            >
              {pending ? "Desactivando…" : "Desactivar programa"}
            </button>
          </>
        ) : null}
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Pioneros</span>
          <strong className={styles.statValue}>{counts.PIONEER}</strong>
          <span className={styles.statHint}>Hoy: {counts.pioneersToday}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Beta</span>
          <strong className={styles.statValue}>{counts.BETA}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Activos</span>
          <strong className={styles.statValue}>{counts.ACTIVE}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Bloqueados</span>
          <strong className={styles.statValue}>{counts.BLOCKED}</strong>
        </div>
      </div>

      <form className={styles.searchRow} onSubmit={applySearch}>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Buscar por nombre o teléfono…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className={styles.searchBtn} type="submit">
          Buscar
        </button>
      </form>

      <div className={styles.filters}>
        {filters.map((item) => {
          const params = new URLSearchParams();
          if (item.id !== "all") params.set("status", item.id);
          if (query.trim()) params.set("q", query.trim());
          const href = params.toString()
            ? `/ops/users?${params}`
            : "/ops/users";
          return (
            <Link
              key={item.id}
              href={href}
              className={`${styles.filterLink} ${
                filter === item.id ? styles.filterActive : ""
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className={styles.bulkBar}>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={toggleAllVisiblePioneers}
          disabled={pioneers.length === 0}
        >
          Seleccionar pioneros (máx. {MAX_BULK_BETA})
        </button>
        <button
          type="button"
          className={styles.bulkBtn}
          onClick={runBulkBeta}
          disabled={pending || selectedPioneers.length === 0}
        >
          {pending
            ? "Enviando…"
            : `Enviar a Beta (${selectedPioneers.length})`}
        </button>
        {message ? <span className={styles.bulkMsg}>{message}</span> : null}
      </div>

      <div className={styles.tableWrap}>
        {users.length === 0 ? (
          <p className={styles.empty}>No hay usuarios en este filtro.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th />
                <th>Nombre</th>
                <th>Preferido</th>
                <th>Teléfono</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>Registro</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const checked = selected.includes(user.id);
                return (
                  <tr key={user.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={user.status !== "PIONEER"}
                        onChange={() => toggle(user.id, user.status)}
                        aria-label={`Seleccionar ${user.full_name || user.phone}`}
                      />
                    </td>
                    <td>{user.full_name || "—"}</td>
                    <td>{user.preferred_name || user.name || "—"}</td>
                    <td>{user.phone}</td>
                    <td>{sourceLabel(user.registration_source)}</td>
                    <td>
                      <span className={badgeClass(user.status, styles)}>
                        {user.status}
                      </span>
                    </td>
                    <td>{formatRegisteredAt(user.registered_at)}</td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={pending || user.status === "BETA"}
                          onClick={() =>
                            startTransition(async () => {
                              await invitePassengerToBeta(user.id);
                              router.refresh();
                            })
                          }
                        >
                          Invitar a pruebas
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={pending || user.status === "ACTIVE"}
                          onClick={() =>
                            startTransition(async () => {
                              await activatePassenger(user.id);
                              router.refresh();
                            })
                          }
                        >
                          Activar
                        </button>
                        <button
                          type="button"
                          className={styles.actionBtn}
                          disabled={pending || user.status === "BLOCKED"}
                          onClick={() =>
                            startTransition(async () => {
                              await blockPassenger(user.id);
                              router.refresh();
                            })
                          }
                        >
                          Bloquear
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
