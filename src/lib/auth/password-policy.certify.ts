/**
 * Certificación local (sin I/O) de la política de contraseña web.
 * Ejecutar: npx tsx src/lib/auth/password-policy.certify.ts
 */

import {
  getPasswordValidationError,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from "./password-policy";

function assert(condition: boolean, label: string) {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`OK: ${label}`);
}

assert(MIN_PASSWORD_LENGTH === 8, "mínimo 8 caracteres");
assert(
  getPasswordValidationError("1234567") !== null,
  "rechaza contraseña corta",
);
assert(
  getPasswordValidationError("12345678") === null,
  "acepta 8+ caracteres",
);
assert(isValidEmail("a@b.co") === true, "email válido");
assert(isValidEmail("no-email") === false, "email inválido");
assert(isValidEmail("") === false, "email vacío");

console.log("password-policy.certify: OK");
