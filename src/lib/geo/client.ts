import {
  getGoogleMapsApiKey,
  GOOGLE_FETCH_TIMEOUT_MS,
} from "@/lib/geo/config";

export class GoogleMapsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = "GoogleMapsError";
  }
}

type GoogleFetchOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Query string (sin api key; se añade automáticamente en GET si includeKeyInQuery). */
  searchParams?: Record<string, string>;
  includeKeyInQuery?: boolean;
  timeoutMs?: number;
};

/**
 * Fetch a Google APIs con timeout, key server-side y logs sin secretos.
 */
export async function fetchGoogleJson<T>(
  url: string,
  options: GoogleFetchOptions = {},
): Promise<T> {
  const key = getGoogleMapsApiKey();
  const timeoutMs = options.timeoutMs ?? GOOGLE_FETCH_TIMEOUT_MS;
  const method = options.method ?? "GET";

  let finalUrl = url;
  if (options.searchParams || options.includeKeyInQuery) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(options.searchParams ?? {})) {
      u.searchParams.set(k, v);
    }
    if (options.includeKeyInQuery !== false && method === "GET") {
      u.searchParams.set("key", key);
    }
    finalUrl = u.toString();
  }

  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (method === "POST") {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    headers["X-Goog-Api-Key"] = key;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(finalUrl, {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      // Diagnóstico: cuerpo completo (sin filtrar el error de Google).
      console.error("[geo:error] FULL_RESPONSE", {
        status: response.status,
        statusText: response.statusText,
        url: url.replace(/key=[^&]+/gi, "key=REDACTED"),
        hasApiKeyHeader: Boolean(headers["X-Goog-Api-Key"]),
        apiKeyPrefix: headers["X-Goog-Api-Key"]
          ? `${String(headers["X-Goog-Api-Key"]).slice(0, 8)}…(len=${String(headers["X-Goog-Api-Key"]).length})`
          : null,
        body: text,
      });
      throw new GoogleMapsError(
        `Google API error: ${response.status} ${text}`,
        response.status,
        text,
      );
    }

    if (!text) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof GoogleMapsError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[geo:error]", { reason: "timeout", url, timeoutMs });
      throw new GoogleMapsError(`Google API timeout after ${timeoutMs}ms`);
    }
    console.error("[geo:error]", {
      reason: error instanceof Error ? error.message : String(error),
      url,
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Un reintento ante fallo de red/5xx. */
export async function fetchGoogleJsonWithRetry<T>(
  url: string,
  options: GoogleFetchOptions = {},
): Promise<T> {
  try {
    return await fetchGoogleJson<T>(url, options);
  } catch (error) {
    const status =
      error instanceof GoogleMapsError ? error.status : undefined;
    if (status !== undefined && status < 500 && status !== 429) {
      throw error;
    }
    console.warn("[geo] reintento tras fallo", {
      status: status ?? "network",
    });
    return fetchGoogleJson<T>(url, options);
  }
}
