/**
 * Genera filas SQL para holidays (solo para poblar DB — no usa el Tariff Engine).
 * Ejecutar: npx tsx scripts/generate-co-holidays-sql.ts
 */
import Holidays from "date-holidays";

const hd = new Holidays("CO");
const rows: string[] = [];

for (const year of [2025, 2026, 2027]) {
  const seen = new Set<string>();
  for (const h of hd.getHolidays(year).filter((x) => x.type === "public")) {
    const d = h.date.slice(0, 10);
    if (seen.has(d)) continue;
    seen.add(d);
    const name = String(h.name).replace(/'/g, "''");
    rows.push(`  ('CO', '${d}'::date, '${name}', 'date-holidays')`);
  }
}

console.log(rows.join(",\n"));
console.error(`-- count=${rows.length}`);
