import { GOOGLE_FETCH_TIMEOUT_MS } from "@/lib/geo/config";

export class MapboxApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MapboxApiError";
  }
}

export function redactMapboxSecrets(value: string): string {
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=REDACTED")
    .replace(/pk\.[0-9A-Za-z._-]+/g, "[MAPBOX_TOKEN_REDACTED]")
    .replace(/sk\.[0-9A-Za-z._-]+/g, "[MAPBOX_TOKEN_REDACTED]");
}

export async function fetchMapboxJson<T>(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? GOOGLE_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      console.error("[geo:mapbox] error", {
        status: response.status,
        url: redactMapboxSecrets(url.split("?")[0] ?? url),
      });
      throw new MapboxApiError(
        `Mapbox API error: ${response.status}`,
        response.status,
      );
    }
    if (!text) {
      return {} as T;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof MapboxApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new MapboxApiError(`Mapbox API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
