import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para el navegador (anon key).
 * Usar solo en Client Components / Auth web.
 * No confundir con getSupabase() (service role, solo servidor).
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createBrowserClient(url, anonKey);
}
