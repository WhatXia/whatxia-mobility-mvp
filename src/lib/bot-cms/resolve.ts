/**
 * BOT-CMS-002 — Consumo runtime: solo configuración PUBLISHED.
 * Si falta: log de error + fallback temporal del catálogo (única copia en código).
 */

import { getSupabase } from "@/lib/supabase/client";

const CACHE_TTL_MS = 30_000;
const messageCache = new Map<
  string,
  { at: number; body: string | null; fromCms: boolean }
>();
const treeCache = new Map<
  string,
  { at: number; value: PublishedTree | null }
>();

export type PublishedTreeNode = {
  code: string;
  name: string;
  stage: string | null;
  content_type: string;
  body: string;
  interactive_payload: Record<string, unknown>;
  message_code: string | null;
  is_entry: boolean;
};

export type PublishedTreeEdge = {
  from_code: string;
  to_code: string;
  label: string;
  trigger_type: string;
  trigger_value: string;
  sort_order: number;
};

export type PublishedTree = {
  code: string;
  name: string;
  audience: string;
  version: number;
  root_node_code: string | null;
  nodes: PublishedTreeNode[];
  edges: PublishedTreeEdge[];
};

export function invalidateBotCmsCache() {
  messageCache.clear();
  treeCache.clear();
}

function applyVars(body: string, vars?: Record<string, string>): string {
  if (!vars) return body;
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

function logMissingPublished(code: string, reason: string) {
  console.error("[bot-cms:unpublished-or-missing]", {
    code,
    reason,
    action: "using_catalog_fallback",
  });
}

/**
 * Resuelve body publicado. Si no hay CMS: log + fallback.
 * Preferir `cms(code)` de copy.ts que ya aporta fallback del catálogo.
 */
export async function resolvePublishedBody(
  code: string,
  fallback: string,
  vars?: Record<string, string>,
): Promise<string> {
  const key = code.toUpperCase();
  const cached = messageCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    if (!cached.fromCms) {
      // keep noisy logs rate-limited via cache window
    }
    return applyVars(cached.body ?? fallback, vars);
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bot_messages")
      .select("body, status, is_active, interactive_payload")
      .eq("code", key)
      .eq("status", "PUBLISHED")
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      logMissingPublished(key, error.message);
      messageCache.set(key, { at: now, body: null, fromCms: false });
      return applyVars(fallback, vars);
    }

    if (!data?.body) {
      logMissingPublished(key, "not_published_or_inactive");
      messageCache.set(key, { at: now, body: null, fromCms: false });
      return applyVars(fallback, vars);
    }

    const body = String(data.body);
    messageCache.set(key, { at: now, body, fromCms: true });
    return applyVars(body, vars);
  } catch (err) {
    logMissingPublished(
      key,
      err instanceof Error ? err.message : "exception",
    );
    messageCache.set(key, { at: now, body: null, fromCms: false });
    return applyVars(fallback, vars);
  }
}

/** Árbol conversacional publicado. */
export async function getPublishedConversationTree(
  code: string,
  environment: "PRODUCTION" | "TEST" = "PRODUCTION",
): Promise<PublishedTree | null> {
  const key = `${code.toUpperCase()}:${environment}`;
  const cached = treeCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const supabase = getSupabase();
    const { data: tree, error } = await supabase
      .from("bot_conversation_trees")
      .select("*")
      .eq("code", code.toUpperCase())
      .eq("status", "PUBLISHED")
      .eq("is_active", true)
      .eq("environment", environment)
      .maybeSingle();

    if (error || !tree) {
      if (error) {
        console.error("[bot-cms:tree-missing]", {
          code: code.toUpperCase(),
          reason: error.message,
        });
      } else {
        console.error("[bot-cms:tree-missing]", {
          code: code.toUpperCase(),
          reason: "not_published_or_inactive",
        });
      }
      treeCache.set(key, { at: now, value: null });
      return null;
    }

    const treeId = String(tree.id);
    const [{ data: nodes }, { data: edges }] = await Promise.all([
      supabase
        .from("bot_conversation_nodes")
        .select("*")
        .eq("tree_id", treeId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("bot_conversation_edges")
        .select("*")
        .eq("tree_id", treeId)
        .order("sort_order", { ascending: true }),
    ]);

    const nodeRows = nodes ?? [];
    const idToCode = new Map(
      nodeRows.map((n) => [String(n.id), String(n.code)]),
    );
    const rootCode = tree.root_node_id
      ? idToCode.get(String(tree.root_node_id)) ?? null
      : null;

    const value: PublishedTree = {
      code: String(tree.code),
      name: String(tree.name),
      audience: String(tree.audience),
      version: Number(tree.version ?? 1),
      root_node_code: rootCode,
      nodes: nodeRows.map((n) => ({
        code: String(n.code),
        name: String(n.name),
        stage: (n.stage as string | null) ?? null,
        content_type: String(n.content_type ?? "text"),
        body: String(n.body ?? ""),
        interactive_payload:
          (n.interactive_payload as Record<string, unknown>) ?? {},
        message_code: (n.message_code as string | null) ?? null,
        is_entry: Boolean(n.is_entry),
      })),
      edges: (edges ?? []).map((e) => ({
        from_code: idToCode.get(String(e.from_node_id)) ?? "",
        to_code: idToCode.get(String(e.to_node_id)) ?? "",
        label: String(e.label ?? ""),
        trigger_type: String(e.trigger_type ?? "button"),
        trigger_value: String(e.trigger_value ?? ""),
        sort_order: Number(e.sort_order ?? 0),
      })),
    };

    treeCache.set(key, { at: now, value });
    return value;
  } catch (err) {
    console.error("[bot-cms:tree-missing]", {
      code: code.toUpperCase(),
      reason: err instanceof Error ? err.message : "exception",
    });
    treeCache.set(key, { at: now, value: null });
    return null;
  }
}

export async function resolvePublishedNodeBody(
  treeCode: string,
  nodeCode: string,
  fallback: string,
  vars?: Record<string, string>,
): Promise<string> {
  const tree = await getPublishedConversationTree(treeCode);
  const node = tree?.nodes.find((n) => n.code === nodeCode.toUpperCase());
  if (!node?.body) {
    console.error("[bot-cms:node-missing]", {
      treeCode,
      nodeCode,
      action: "using_fallback",
    });
    return applyVars(fallback, vars);
  }
  if (node.message_code) {
    return resolvePublishedBody(node.message_code, node.body, vars);
  }
  return applyVars(node.body, vars);
}
