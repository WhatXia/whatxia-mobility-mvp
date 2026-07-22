/**
 * Sprint 28 — diagnóstico Places en Ibagué.
 * Uso: npx tsx scripts/places-ibague-diag.ts
 * No imprime la API key.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  if (process.env.GOOGLE_MAPS_API_KEY) return;
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^GOOGLE_MAPS_API_KEY=(.*)$/);
      if (m) {
        process.env.GOOGLE_MAPS_API_KEY = m[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const CENTER = { latitude: 4.4389, longitude: -75.2322 };
const RADIUS_M = 18000;
const QUERIES = [
  "Gobernación",
  "Multicentro",
  "Terminal",
  "Aeropuerto",
  "Plaza de Bolívar",
];

async function search(
  apiKey: string,
  textQuery: string,
  locationField: "locationRestriction" | "locationBias",
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const circle = { circle: { center: CENTER, radius: RADIUS_M } };
  const body: Record<string, unknown> = {
    textQuery,
    languageCode: "es",
    regionCode: "CO",
    maxResultCount: 5,
    [locationField]: circle,
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, body: json };
}

function summarize(body: unknown): string {
  const places = (body as { places?: Array<{ displayName?: { text?: string } }> })
    ?.places;
  if (!places?.length) {
    const err = (body as { error?: { message?: string; status?: string } })?.error;
    if (err) return `ERROR ${err.status ?? ""}: ${err.message ?? JSON.stringify(err)}`;
    return "0 places";
  }
  return places.map((p) => p.displayName?.text ?? "?").join(" | ");
}

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("Missing GOOGLE_MAPS_API_KEY");
    process.exit(1);
  }

  console.log("Centro Ibagué:", CENTER);
  console.log("Radio:", RADIUS_M, "metros (= 18 km)");
  console.log("");

  console.log("=== A) locationRestriction.circle (Sprint 26) ===");
  {
    const r = await search(
      apiKey,
      "Gobernación, Ibagué, Tolima",
      "locationRestriction",
    );
    console.log(`status=${r.status} -> ${summarize(r.body)}`);
  }

  console.log("");
  console.log("=== B) locationBias.circle (fix Sprint 28) ===");
  for (const q of QUERIES) {
    const textQuery = `${q}, Ibagué, Tolima`;
    const r = await search(apiKey, textQuery, "locationBias");
    console.log(`[${q}] status=${r.status} query="${textQuery}" -> ${summarize(r.body)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
