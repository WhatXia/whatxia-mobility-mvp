/**
 * Mensajes de usuario para el flujo de recuperación (Supabase Auth).
 * No revelan si un correo existe o no.
 */

export const RECOVERY_REQUEST_CONFIRMATION =
  "Si el correo existe en el sistema, recibirás un enlace para restablecer tu contraseña.";

export const PASSWORD_UPDATED_CONFIRMATION =
  "Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión.";

export function mapAuthErrorMessage(error: {
  message?: string;
  code?: string;
  status?: number;
} | null): string {
  if (!error) {
    return "Ocurrió un error inesperado. Intenta de nuevo.";
  }

  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (
    code.includes("otp_expired") ||
    message.includes("expired") ||
    message.includes("expirado")
  ) {
    return "El enlace de recuperación expiró. Solicita uno nuevo.";
  }

  if (
    code.includes("otp") ||
    code.includes("token") ||
    message.includes("invalid") ||
    message.includes("token") ||
    message.includes("otp")
  ) {
    return "El enlace de recuperación no es válido. Solicita uno nuevo.";
  }

  if (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("failed to fetch")
  ) {
    return "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.";
  }

  if (
    message.includes("password") &&
    (message.includes("weak") || message.includes("least"))
  ) {
    return "La contraseña no cumple los requisitos de seguridad.";
  }

  if (
    message.includes("invalid login") ||
    message.includes("invalid credentials")
  ) {
    return "Correo o contraseña incorrectos.";
  }

  return "No pudimos completar la operación. Intenta de nuevo en unos momentos.";
}

export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3002";
}
