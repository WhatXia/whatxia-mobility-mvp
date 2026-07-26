import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Intercambio oficial del enlace de recuperación de Supabase Auth.
 * Soporta PKCE (?code=) y token_hash + type (plantilla email / verifyOtp).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextRaw = searchParams.get("next") ?? "/auth/reset-password";
  const next = nextRaw.startsWith("/") ? nextRaw : "/auth/reset-password";

  const supabase = await createServerSupabaseClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
    return NextResponse.redirect(
      new URL("/auth/error?reason=invalid", origin),
    );
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }

    const message = (error.message ?? "").toLowerCase();
    const reason =
      message.includes("expired") || error.code === "otp_expired"
        ? "expired"
        : "invalid";
    return NextResponse.redirect(
      new URL(`/auth/error?reason=${reason}`, origin),
    );
  }

  return NextResponse.redirect(new URL("/auth/error?reason=invalid", origin));
}
