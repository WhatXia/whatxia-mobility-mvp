/**
 * Prueba técnica — ubicación nativa vs URL en oferta "Nuevo servicio".
 *
 * NO modifica el flujo de producción. Solo envía mensajes de prueba a un teléfono.
 *
 * Uso:
 *   npx tsx scripts/wa-offer-location-probe.ts --to=573001234567 --mode=native
 *   npx tsx scripts/wa-offer-location-probe.ts --to=573001234567 --mode=preview
 *   npx tsx scripts/wa-offer-location-probe.ts --to=573001234567 --mode=both
 *
 * Requisitos:
 *   - WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en .env.local (o entorno)
 *   - El destinatario debe haber escrito al número de negocio en las últimas 24 h
 *     (ventana de servicio; location e interactive no son plantillas).
 *
 * Hallazgo de API (documentado aquí a propósito de la prueba):
 *   - Sí se puede enviar ubicación nativa: type "location" (ya existe sendLocationMessage).
 *   - NO se puede incrustar un pin de ubicación DENTRO del mismo mensaje interactive
 *     de botones Aceptar/Rechazar. Hay que enviar DOS mensajes en secuencia:
 *       1) location  2) interactive buttons (sin URL).
 *   - Segunda opción: texto con preview_url:true (enlace clicable / preview de Maps).
 *
 * Qué validar en el teléfono del conductor:
 *   A) native — pin nativo → tocar → ¿abre Maps / navegación del sistema?
 *   B) preview — ¿el link se ve clicable / con preview y abre Maps?
 *   C) Orden — ¿location antes de botones se lee natural o confunde?
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore
  }
}

loadEnvLocal();

const SAMPLE_PICKUP = {
  latitude: 4.4389,
  longitude: -75.2322,
  name: "Plaza de Bolívar (prueba)",
  address: "Ibagué, Tolima",
};

function parseArgs(argv: string[]) {
  let to: string | null = null;
  let mode: "native" | "preview" | "both" = "both";

  for (const arg of argv) {
    if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length).replace(/\D/g, "");
    }
    if (arg.startsWith("--mode=")) {
      const m = arg.slice("--mode=".length);
      if (m === "native" || m === "preview" || m === "both") {
        mode = m;
      }
    }
  }

  return { to, mode };
}

async function sendWhatsApp(payload: Record<string, unknown>) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION ?? "v21.0";

  if (!token || !phoneNumberId) {
    throw new Error(
      "Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID (.env.local).",
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
    },
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`WhatsApp API ${response.status}: ${bodyText}`);
  }

  return JSON.parse(bodyText) as { messages?: Array<{ id: string }> };
}

function offerBodyWithoutUrl(): string {
  return [
    "🚖 Nuevo servicio (PRUEBA técnica)",
    "",
    `📍 Recoger en: ${SAMPLE_PICKUP.name}`,
    "🎯 Destino: Multicentro (ejemplo)",
    "📏 Distancia estimada: 3.2 km",
    "⏱️ Tiempo estimado: 12 min",
    "💰 Valor del servicio: $8.500",
    "",
    "Aceptar el servicio:",
  ].join("\n");
}

async function sendNativeLocationThenOffer(to: string) {
  console.log("\n=== A) Ubicación nativa + oferta SIN URL ===");

  const loc = await sendWhatsApp({
    to,
    type: "location",
    location: {
      latitude: SAMPLE_PICKUP.latitude,
      longitude: SAMPLE_PICKUP.longitude,
      name: SAMPLE_PICKUP.name,
      address: SAMPLE_PICKUP.address,
    },
  });
  console.log("location ok:", loc.messages?.[0]?.id ?? loc);

  // Pequeña pausa para que WhatsApp ordene location antes que botones.
  await new Promise((r) => setTimeout(r, 400));

  const offer = await sendWhatsApp({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: offerBodyWithoutUrl() },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "probe_accept", title: "✅ Aceptar" },
          },
          {
            type: "reply",
            reply: { id: "probe_reject", title: "❌ Rechazar" },
          },
        ],
      },
    },
  });
  console.log("offer buttons ok:", offer.messages?.[0]?.id ?? offer);
  console.log(
    "Validar: tocar el pin → ¿abre Google Maps / app de navegación del teléfono?",
  );
}

async function sendPreviewUrlOffer(to: string) {
  console.log("\n=== B) Segunda opción: texto + preview_url (enlace clicable) ===");

  const mapsUrl = `https://www.google.com/maps?q=${SAMPLE_PICKUP.latitude},${SAMPLE_PICKUP.longitude}`;

  const text = await sendWhatsApp({
    to,
    type: "text",
    text: {
      preview_url: true,
      body: [
        "🧭 Ubicación de recogida (PRUEBA preview_url):",
        mapsUrl,
      ].join("\n"),
    },
  });
  console.log("preview text ok:", text.messages?.[0]?.id ?? text);

  await new Promise((r) => setTimeout(r, 400));

  const offer = await sendWhatsApp({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: [
          "🚖 Nuevo servicio (PRUEBA preview)",
          "",
          `📍 Recoger en: ${SAMPLE_PICKUP.name}`,
          "(La URL va en el mensaje anterior, no aquí)",
          "",
          "Aceptar el servicio:",
        ].join("\n"),
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "probe_accept_b", title: "✅ Aceptar" },
          },
          {
            type: "reply",
            reply: { id: "probe_reject_b", title: "❌ Rechazar" },
          },
        ],
      },
    },
  });
  console.log("offer buttons ok:", offer.messages?.[0]?.id ?? offer);
  console.log(
    "Validar: ¿el enlace se ve clicable / con tarjeta preview y abre Maps?",
  );
}

async function main() {
  const { to, mode } = parseArgs(process.argv.slice(2));

  if (!to) {
    console.error(
      "Uso: npx tsx scripts/wa-offer-location-probe.ts --to=57300... [--mode=native|preview|both]",
    );
    process.exit(1);
  }

  console.log("Destinatario:", to);
  console.log("Modo:", mode);
  console.log("Coords muestra:", SAMPLE_PICKUP);

  if (mode === "native" || mode === "both") {
    await sendNativeLocationThenOffer(to);
  }
  if (mode === "preview" || mode === "both") {
    await sendPreviewUrlOffer(to);
  }

  console.log("\n--- Resumen de limitaciones (API) ---");
  console.log(
    "1. location nativa: SOPORTADA (mensaje type=location separado).",
  );
  console.log(
    "2. No se puede meter el pin dentro del interactive de Aceptar/Rechazar.",
  );
  console.log(
    "3. Flujo viable = location → luego botones sin URL (como modo native).",
  );
  console.log(
    "4. Fallback = text con preview_url:true (modo preview).",
  );
  console.log(
    "5. Producción NO se cambió; decide después de probar en el teléfono.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
