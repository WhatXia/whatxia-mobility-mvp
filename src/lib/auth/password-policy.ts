/**
 * Política de contraseña para Auth web (Supabase Auth).
 * Alineada con validatePasswordPlain (mín. 8) sin importar crypto de Node.
 */

export const MIN_PASSWORD_LENGTH = 8;

export function getPasswordValidationError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  // Validación práctica (no exhaustiva RFC).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
