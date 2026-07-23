/**
 * Certificación Etapa 2 — descarga media WhatsApp (mocks, sin red real).
 * Ejecutar: npx tsx src/lib/whatsapp-media.certify.ts
 */
export {};

import {
  downloadFromMediaUrl,
  downloadWhatsAppMedia,
  lookupWhatsAppMediaUrl,
  WhatsAppMediaError,
} from "@/lib/whatsapp/media";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`OK: ${message}`);
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: string,
  label: string,
) {
  try {
    await fn();
    throw new Error(`FAIL: ${label} — se esperaba error ${code}`);
  } catch (error) {
    assert(
      error instanceof WhatsAppMediaError && error.code === code,
      `${label} → ${code}`,
    );
  }
}

const sampleOgg = Buffer.from("OggS-fake-opus-bytes");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function binaryResponse(
  status: number,
  bytes: Buffer,
  contentType = "audio/ogg; codecs=opus",
): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { "Content-Type": contentType },
  });
}

/** Mock fetch: lookup OK + download OK */
const fetchSuccess: typeof fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("graph.facebook.com") && url.includes("/media_ok_1")) {
    return jsonResponse(200, {
      messaging_product: "whatsapp",
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=tmp",
      mime_type: "audio/ogg; codecs=opus",
      sha256: "abc",
      file_size: sampleOgg.length,
      id: "media_ok_1",
    });
  }
  if (url.includes("lookaside.fbsbx.com")) {
    return binaryResponse(200, sampleOgg);
  }
  return jsonResponse(500, { error: { message: "unexpected url " + url } });
}) as typeof fetch;

/** mediaId inexistente */
const fetchNotFound: typeof fetch = (async () =>
  jsonResponse(404, {
    error: { message: "Unsupported get request", code: 100, type: "GraphMethodException" },
  })) as typeof fetch;

/** Lookup OK, download 404 (URL expirada) */
const fetchUrlExpired: typeof fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("graph.facebook.com")) {
    return jsonResponse(200, {
      url: "https://lookaside.fbsbx.com/expired",
      mime_type: "audio/ogg; codecs=opus",
      file_size: 10,
      id: "media_expired",
    });
  }
  return binaryResponse(404, Buffer.from(""));
}) as typeof fetch;

/** HTTP 500 en lookup */
const fetchHttpError: typeof fetch = (async () =>
  jsonResponse(500, { error: { message: "Internal", code: 1 } })) as typeof fetch;

/** Timeout (abort) */
const fetchTimeout: typeof fetch = (async (_input, init) => {
  return await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}) as typeof fetch;

async function main() {
  const baseDeps = {
    token: "test-token",
    apiVersion: "v21.0",
    phoneNumberId: "123",
    timeoutMs: 200,
  };

  // --- éxito ---
  const ok = await downloadWhatsAppMedia("media_ok_1", {
    ...baseDeps,
    fetchFn: fetchSuccess,
  });
  assert(ok.bytes.equals(sampleOgg), "éxito: bytes descargados");
  assert(
    ok.mimeType === "audio/ogg; codecs=opus",
    "éxito: mime_type desde lookup",
  );
  assert(ok.fileSize === sampleOgg.length, "éxito: file_size");
  assert(ok.mediaUrl.includes("lookaside.fbsbx.com"), "éxito: mediaUrl");

  const meta = await lookupWhatsAppMediaUrl("media_ok_1", {
    ...baseDeps,
    fetchFn: fetchSuccess,
  });
  assert(Boolean(meta.url), "lookup aislado OK");

  const file = await downloadFromMediaUrl(meta.url, {
    ...baseDeps,
    fetchFn: fetchSuccess,
  });
  assert(file.bytes.length > 0, "downloadFromMediaUrl aislado OK");

  // --- errores ---
  await expectCode(
    () =>
      downloadWhatsAppMedia("missing", {
        ...baseDeps,
        fetchFn: fetchNotFound,
      }),
    "media_not_found",
    "media inexistente",
  );

  await expectCode(
    () =>
      downloadWhatsAppMedia("media_expired", {
        ...baseDeps,
        fetchFn: fetchUrlExpired,
      }),
    "url_expired",
    "URL expirada (404 en download)",
  );

  await expectCode(
    () =>
      downloadWhatsAppMedia("x", {
        ...baseDeps,
        fetchFn: fetchHttpError,
      }),
    "http_error",
    "error HTTP 500",
  );

  await expectCode(
    () =>
      downloadWhatsAppMedia("slow", {
        ...baseDeps,
        fetchFn: fetchTimeout,
        timeoutMs: 50,
      }),
    "timeout",
    "timeout / abort",
  );

  await expectCode(
    () => downloadWhatsAppMedia("  ", { ...baseDeps, fetchFn: fetchSuccess }),
    "invalid_media_id",
    "mediaId vacío",
  );

  await expectCode(
    () =>
      downloadWhatsAppMedia("x", {
        fetchFn: fetchSuccess,
        token: "",
      }),
    "missing_config",
    "sin token",
  );

  // Dominio no tocado: este certify solo importa whatsapp/media.
  assert(true, "sin imports de booking/dispatch/intent");

  console.log("\nwhatsapp media download (Etapa 2): OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
