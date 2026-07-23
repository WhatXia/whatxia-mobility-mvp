/**
 * Descarga de media WhatsApp Cloud API (Etapa 2).
 *
 * Flujo Meta:
 * 1) GET /{mediaId}?phone_number_id=... → { url, mime_type, file_size, ... }
 * 2) GET {url} + Bearer → bytes (URL ~5 min; mediaId webhook ~7 días)
 *
 * Solo capa WhatsApp. No STT. No dominio Mobility.
 */

export type MediaDownloadResult = {
  bytes: Buffer;
  mimeType: string | null;
  fileSize: number | null;
  /** URL temporal usada (solo diagnóstico; no persistir). */
  mediaUrl: string;
};

export type MediaDownloadErrorCode =
  | "missing_config"
  | "invalid_media_id"
  | "media_not_found"
  | "url_expired"
  | "http_error"
  | "timeout"
  | "empty_body"
  | "invalid_meta_response";

export class WhatsAppMediaError extends Error {
  readonly code: MediaDownloadErrorCode;
  readonly status: number | null;

  constructor(
    code: MediaDownloadErrorCode,
    message: string,
    options?: { status?: number | null; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "WhatsAppMediaError";
    this.code = code;
    this.status = options?.status ?? null;
  }
}

export type MediaDownloadDeps = {
  /** Inyectable para pruebas. */
  fetchFn?: typeof fetch;
  token?: string;
  apiVersion?: string;
  phoneNumberId?: string;
  /** Timeout por request (lookup + download). Default 20s. */
  timeoutMs?: number;
};

type MediaLookupResponse = {
  url?: string;
  mime_type?: string;
  file_size?: number | string;
  id?: string;
  messaging_product?: string;
  error?: { message?: string; type?: string; code?: number };
};

const DEFAULT_TIMEOUT_MS = 20_000;

function resolveConfig(deps?: MediaDownloadDeps) {
  const token = deps?.token ?? process.env.WHATSAPP_TOKEN;
  const apiVersion =
    deps?.apiVersion ?? process.env.WHATSAPP_API_VERSION ?? "v21.0";
  const phoneNumberId =
    deps?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token) {
    throw new WhatsAppMediaError(
      "missing_config",
      "Falta WHATSAPP_TOKEN para descargar media.",
    );
  }

  return { token, apiVersion, phoneNumberId: phoneNumberId ?? null };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new WhatsAppMediaError(
        "timeout",
        `Timeout tras ${timeoutMs}ms al solicitar media.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Paso 1: resuelve URL temporal a partir del mediaId del webhook.
 */
export async function lookupWhatsAppMediaUrl(
  mediaId: string,
  deps?: MediaDownloadDeps,
): Promise<{
  url: string;
  mimeType: string | null;
  fileSize: number | null;
}> {
  const id = mediaId.trim();
  if (!id) {
    throw new WhatsAppMediaError(
      "invalid_media_id",
      "mediaId vacío o inválido.",
    );
  }

  const { token, apiVersion, phoneNumberId } = resolveConfig(deps);
  const fetchFn = deps?.fetchFn ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const params = new URLSearchParams();
  if (phoneNumberId) {
    params.set("phone_number_id", phoneNumberId);
  }
  const qs = params.toString();
  const lookupUrl = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      lookupUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof WhatsAppMediaError) {
      throw error;
    }
    throw new WhatsAppMediaError(
      "http_error",
      "Error de red al consultar mediaId.",
      { cause: error },
    );
  }

  const bodyText = await response.text();

  if (response.status === 404) {
    throw new WhatsAppMediaError(
      "media_not_found",
      `Media no encontrado o mediaId expirado: ${id}`,
      { status: 404 },
    );
  }

  if (!response.ok) {
    throw new WhatsAppMediaError(
      "http_error",
      `Lookup media falló HTTP ${response.status}: ${bodyText.slice(0, 300)}`,
      { status: response.status },
    );
  }

  let data: MediaLookupResponse;
  try {
    data = JSON.parse(bodyText) as MediaLookupResponse;
  } catch (error) {
    throw new WhatsAppMediaError(
      "invalid_meta_response",
      "Respuesta de lookup no es JSON válido.",
      { cause: error },
    );
  }

  if (data.error) {
    const code = data.error.code;
    if (code === 100 || response.status === 400) {
      throw new WhatsAppMediaError(
        "media_not_found",
        data.error.message ?? "Media no encontrado (Graph error).",
        { status: response.status },
      );
    }
    throw new WhatsAppMediaError(
      "http_error",
      data.error.message ?? "Error Graph al resolver media.",
      { status: response.status },
    );
  }

  if (!data.url?.trim()) {
    throw new WhatsAppMediaError(
      "invalid_meta_response",
      "Lookup OK pero sin campo url.",
    );
  }

  const fileSizeRaw = data.file_size;
  const fileSize =
    typeof fileSizeRaw === "number"
      ? fileSizeRaw
      : typeof fileSizeRaw === "string" && fileSizeRaw.trim()
        ? Number(fileSizeRaw)
        : null;

  return {
    url: data.url,
    mimeType: data.mime_type ?? null,
    fileSize: fileSize != null && Number.isFinite(fileSize) ? fileSize : null,
  };
}

/**
 * Paso 2: descarga bytes desde la URL temporal (requiere Bearer).
 * 404 → url_expired (Meta: renovar lookup).
 */
export async function downloadFromMediaUrl(
  mediaUrl: string,
  deps?: MediaDownloadDeps,
): Promise<{ bytes: Buffer; contentType: string | null }> {
  const { token } = resolveConfig(deps);
  const fetchFn = deps?.fetchFn ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetchFn,
      mediaUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          // Algunos edges de Meta fallan sin User-Agent.
          "User-Agent": "WhatXia-Mobility/1.0",
        },
      },
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof WhatsAppMediaError) {
      throw error;
    }
    throw new WhatsAppMediaError(
      "http_error",
      "Error de red al descargar bytes de media.",
      { cause: error },
    );
  }

  if (response.status === 404) {
    throw new WhatsAppMediaError(
      "url_expired",
      "URL de media expirada o inválida (404). Volver a hacer lookup del mediaId.",
      { status: 404 },
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new WhatsAppMediaError(
      "http_error",
      `Download media falló HTTP ${response.status}: ${errText.slice(0, 300)}`,
      { status: response.status },
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.length === 0) {
    throw new WhatsAppMediaError(
      "empty_body",
      "Download devolvió cuerpo vacío.",
    );
  }

  return {
    bytes,
    contentType: response.headers.get("content-type"),
  };
}

/**
 * Descarga completa: lookup mediaId → download URL → bytes.
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  deps?: MediaDownloadDeps,
): Promise<MediaDownloadResult> {
  const meta = await lookupWhatsAppMediaUrl(mediaId, deps);
  const file = await downloadFromMediaUrl(meta.url, deps);

  return {
    bytes: file.bytes,
    mimeType: meta.mimeType ?? file.contentType,
    fileSize: meta.fileSize ?? file.bytes.length,
    mediaUrl: meta.url,
  };
}
