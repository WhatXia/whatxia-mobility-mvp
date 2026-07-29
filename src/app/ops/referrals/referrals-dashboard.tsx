import styles from "@/app/ops/ops.module.css";
import type {
  OpsReferralLeaderRow,
  OpsReferralProgramStats,
} from "@/lib/referrals";

type Props = {
  stats: OpsReferralProgramStats;
  leaders: OpsReferralLeaderRow[];
};

export function ReferralsDashboard({ stats, leaders }: Props) {
  return (
    <div>
      <p className={styles.subtitle} style={{ marginBottom: "1rem" }}>
        Programa de referidos — clics, registros, atribuciones y conversión.
      </p>

      <div className={styles.filters} style={{ marginBottom: "1.25rem" }}>
        <div className={styles.flag}>
          <strong>Clics:</strong> {stats.totalClicks}
        </div>
        <div className={styles.flag}>
          <strong>Registros:</strong> {stats.totalRegistrations}
        </div>
        <div className={styles.flag}>
          <strong>Atribuidos:</strong> {stats.totalAttributed}
        </div>
        <div className={styles.flag}>
          <strong>Conversiones:</strong> {stats.totalConversions}
        </div>
        <div className={styles.flag}>
          <strong>Conversión:</strong> {stats.conversionPercent}%
        </div>
      </div>

      <p style={{ fontSize: "0.85rem", color: "#3d5248", marginBottom: "1rem" }}>
        Conversión (%) = pasajeros atribuidos ÷ clics del enlace × 100.
        Conversiones = primer viaje completado de un referido.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Conductor</th>
              <th>Código</th>
              <th>Clics</th>
              <th>Atribuidos</th>
              <th>Conv. %</th>
            </tr>
          </thead>
          <tbody>
            {leaders.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "1.5rem" }}>
                  Aún no hay atribuciones de referidos.
                </td>
              </tr>
            ) : (
              leaders.map((row) => {
                const conv =
                  row.clicks > 0
                    ? Math.round((row.attributions / row.clicks) * 1000) / 10
                    : 0;
                return (
                  <tr key={row.driverId}>
                    <td>{row.driverName}</td>
                    <td>{row.referralCode ?? "—"}</td>
                    <td>{row.clicks}</td>
                    <td>{row.attributions}</td>
                    <td>{conv}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
