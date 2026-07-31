/**
 * BOT-CMS-002 — Copy helpers.
 * Única fuente de fallback en código: BOT_CMS_CATALOG.
 * Runtime: CMS publicado; si falta → log error + fallback temporal del catálogo.
 */

import { BOT_CMS_CATALOG, type BotCmsCatalogEntry } from "@/lib/bot-cms/catalog";
import { resolvePublishedBody } from "@/lib/bot-cms/resolve";

const byCode = new Map<string, BotCmsCatalogEntry>(
  BOT_CMS_CATALOG.map((entry) => [entry.code, entry]),
);

export function catalogEntry(code: string): BotCmsCatalogEntry | undefined {
  return byCode.get(code.toUpperCase());
}

/** Fallback temporal (solo catálogo). No usar copy inventado fuera de aquí. */
export function catalogBody(code: string): string {
  const entry = catalogEntry(code);
  if (!entry) {
    console.error("[bot-cms:missing-catalog]", { code });
    return "";
  }
  return entry.body;
}

export function catalogButtons(
  code: string,
): { id: string; title: string }[] {
  const entry = catalogEntry(code);
  return (entry?.buttons ?? []).map((b) => ({ id: b.id, title: b.title }));
}

function applyVars(body: string, vars?: Record<string, string>): string {
  if (!vars) return body;
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/**
 * Resuelve mensaje desde CMS PUBLISHED.
 * Si no existe: log + fallback temporal del catálogo (única copia en código).
 */
export async function cms(
  code: string,
  vars?: Record<string, string>,
): Promise<string> {
  const key = code.toUpperCase();
  const fallback = catalogBody(key);
  const resolved = await resolvePublishedBody(key, fallback, vars);
  if (!fallback && !resolved) {
    console.error("[bot-cms:empty-message]", { code: key });
  }
  return resolved;
}

/** Variante síncrona solo para defaults de constantes (fallback catálogo). */
export function cmsSync(code: string, vars?: Record<string, string>): string {
  return applyVars(catalogBody(code), vars);
}

export function listCatalogCodes(): string[] {
  return BOT_CMS_CATALOG.map((e) => e.code);
}

export function catalogCoverageStats() {
  const byModule: Record<string, number> = {};
  for (const entry of BOT_CMS_CATALOG) {
    byModule[entry.module] = (byModule[entry.module] ?? 0) + 1;
  }
  return {
    total: BOT_CMS_CATALOG.length,
    byModule,
  };
}
