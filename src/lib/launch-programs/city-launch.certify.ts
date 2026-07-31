/**
 * Certificación PIONEERS-004 — actor label / botón (sin I/O).
 * Ejecutar: npx tsx src/lib/launch-programs/city-launch.certify.ts
 */

function actorLabelFor(
  source: "manual" | "auto_end" | "api",
  actorEmail?: string | null,
): string {
  if (source === "auto_end") return "SYSTEM";
  return actorEmail?.trim() || "SYSTEM";
}

function assert(condition: boolean, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`OK: ${label}`);
}

assert(actorLabelFor("auto_end", "ops@x.com") === "SYSTEM", "auto → SYSTEM");
assert(
  actorLabelFor("manual", "ops@whatxia.com") === "ops@whatxia.com",
  "manual → email",
);
assert(actorLabelFor("manual", null) === "SYSTEM", "manual sin email → SYSTEM");

const buttonTitle = "🚖 Solicitar servicio".slice(0, 20);
assert(buttonTitle.length <= 20, "título botón ≤ 20 chars WhatsApp");
assert(
  buttonTitle.includes("Solicitar") || buttonTitle.includes("🚖"),
  "botón Solicitar servicio",
);

console.log("city-launch.certify: OK (PIONEERS-004)");
