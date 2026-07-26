/**
 * Hash de contraseñas de conductor (scrypt).
 * Nunca almacenar ni loguear la contraseña en texto plano.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb);

const SCRYPT_KEYLEN = 64;
/** Formato: scrypt$<salt_b64>$<hash_b64> */
const PREFIX = "scrypt";

export function validatePasswordPlain(password: string): string | null {
  if (password.length < 8) {
    return "La contraseña debe tener mínimo 8 caracteres. Intenta de nuevo.";
  }
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${PREFIX}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  plain: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return false;
  }

  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  const derived = (await scrypt(plain, salt, expected.length)) as Buffer;

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}
