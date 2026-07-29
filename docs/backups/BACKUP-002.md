# BACKUP-002 — Restore Point WhatXia Mobility MVP

**Fecha:** 29 de julio de 2026  
**Código de restore point:** `BACKUP-002`  
**Repositorio:** https://github.com/WhatXia/whatxia-mobility-mvp  
**Rama de trabajo:** `main`  
**Producto:** WhatXia Mobility MVP (`whatxia-mobility-mvp` v0.1.0)  
**Alcance:** Ibagué (Colombia) · Canal WhatsApp Cloud API  

> Sprint **INFRA-002**: auditoría y congelación del estado estable.  
> No se alteró lógica de negocio ni migraciones como parte de este documento;  
> el commit canónico de este restore point congela código + documentación.

---

## 1. Identificación del Restore Point

| Campo | Valor |
|-------|--------|
| **Tag Git** | `backup/BACKUP-002` |
| **Rama de respaldo** | `backup/BACKUP-002` |
| **Commit canónico** | `c819ded345f1aed6669f74089d661a112f010479` |
| **Commit corto** | `c819ded` |
| **BACKUP-001 (referencia)** | Documentación en `docs/backup/` · commit documentado `d8a65d7513906117aef52e89d87edd8e344a69ad` (24 jul 2026) · migraciones hasta **029** |
| **Migraciones en BACKUP-002** | `001` … `040` (inclusive) |

### Qué incluye este restore point

- Código fuente completo del repositorio en el commit canónico.
- Migraciones Supabase `001`–`040`.
- Configuración versionada (`.env.example`, `vercel.json`, `package.json`, Next/TS/ESLint).
- Variables de entorno **documentadas por nombre** (sin secretos).
- Estructura del proyecto (`docs/backups/arbol-BACKUP-002.txt`).
- Documentación técnica (`docs/backup/*` histórico + este archivo).

### Qué no incluye

- Valores de secretos (`.env.local`, Vercel, Supabase dashboard).
- Datos de producción en Supabase (solo esquema vía migraciones).
- Binarios `node_modules` / `.next`.

---

## 2. Estado del proyecto (corte BACKUP-002)

### Stack

| Capa | Tecnología |
|------|------------|
| App | Next.js **16.2.10** (App Router) · React 19 · TypeScript 5 |
| Bot | WhatsApp Cloud API · webhook `POST/GET /api/webhook` |
| Datos | Supabase (Postgres) · acceso servidor con **service role** |
| Auth web | Supabase Auth + `@supabase/ssr` (login / recovery) |
| Deploy | Vercel · crons documents + tunnels |
| Ciudad | Ibagué (`cities` + `fare_rules`) |

### Scripts npm relevantes

| Script | Uso |
|--------|-----|
| `npm run dev` | `next dev -p 3002` |
| `npm run build` | `next build` |
| `npm start` | `next start -p 3002` |
| `npm run lint` | ESLint |
| `npm run test:referrals` | Certificación REF-003 (sin I/O) |

### Validación al cerrar este backup

Ejecutar y confirmar exit code 0:

```bash
npx tsc --noEmit
npm run build
```

---

## 3. Funcionalidades implementadas (estado actual)

### Bot — Pasajeros

- Saludo `Hola` → onboarding identidad (`full_name` → `preferred_name`).
- **Pre-lanzamiento (USER-001):** `PRE_LAUNCH_MODE` → status `PIONEER` | `BETA` | `ACTIVE` | `BLOCKED`.
- Onboarding Pionero simplificado (USER-001.2) + copy (USER-001.3).
- Solicitud de servicio, geo Places/Routes, cotización Tariff Engine, dispatch, waiting flow, cancelaciones.
- Favoritos de recorridos; menú sin Cancelar en idle (UX-002).
- Calificación bidireccional post-viaje.
- Voz → texto (Whisper) si hay `OPENAI_API_KEY`.
- Atribución de referidos al registrarse vía `/r/DRV-XXXXX` (sin cambiar el diálogo de onboarding).

### Bot — Conductores

- Registro, password setup, login / logout, recuperación de contraseña (AUTH-WA-001).
- Menú jerárquico: Disponible · Mi cuenta · Cerrar sesión.
- Mi cuenta → Mi perfil · **Referidos** · Volver (REF-003.1).
- Perfil: datos, rendimiento, actualización segura, cambio de WhatsApp con cooldown 30 días (DRIVER-004.x).
- Ciclo de viaje: oferta, aceptar/rechazar, ETA auto, llegar, iniciar, navegar, finalizar.
- UX conductor acortada / espaciado (UX-004 / 004.1).
- **Hotfix enrutamiento:** conductor registrado nunca entra a onboarding Pionero (🚖 / Iniciar sesión).

### Operations Center

- Rutas: `/ops` → `/ops/users`.
- Listado de pasajeros, filtros por status, búsqueda, contadores Pioneros/Beta/Active/Blocked.
- Acciones: invitar a Beta, activar, bloquear (bulk parcial).
- Columnas de origen (`registration_source`) y fechas (`registered_at`).
- **No** hay UI Ops de Referidos en este corte; el **backend** de referidos (tablas + stats) alimenta el módulo cuando el panel lo consuma.
- Auth web para acceso ops (`/login`, recovery).

### Módulo de Referidos (REF-003)

| Pieza | Estado |
|-------|--------|
| Migración `040_driver_referrals.sql` | Código conductor, `referred_by_driver_id`, attributions, events, pending |
| Bot: enlace en Mi cuenta | Código `DRV-XXXXX`, link, conteo |
| Landing `/r/[code]` | Valida conductor activo → WhatsApp prefill `REF DRV-…` |
| Atribución | Solo si no hay referente previo; `registration_source=REFERRAL` si vacío |
| Tests | `npm run test:referrals` |

---

## 4. Migraciones aplicadas (esquema)

Aplicar en orden en SQL Editor / CLI:

| Rango | Contenido resumido |
|-------|-------------------|
| 001–029 | Núcleo MVP (BACKUP-001): drivers, trips, passengers, sessions, tunnels, cancel, search, geo/fare, city, waiting, tariff, holidays, taximeter test, email/operation card |
| 030 | `document_id` unique en drivers |
| 031–032 | `password_hash`, sesiones auth conductor |
| 033–034 | Favoritos de rutas; ratings pasajero |
| 035–036 | `preferred_name` / `full_name` identidad |
| 037 | Auditoría perfil + cambio WhatsApp |
| 038–039 | `passengers.status`, `registered_at`, `registration_source` |
| **040** | **Referidos:** `drivers.referral_code`, `passengers.referred_by_driver_id`, `referral_attributions`, `referral_events`, `referral_pending` |

Verificación sugerida:

```sql
select column_name from information_schema.columns
where table_name = 'drivers' and column_name = 'referral_code';

select tablename from pg_tables
where schemaname = 'public'
  and tablename in ('referral_attributions', 'referral_events', 'referral_pending');
```

---

## 5. Variables de entorno requeridas

Solo **nombres** (valores en Vercel / `.env.local`, nunca en Git).

### Core (obligatorias producción)

| Nombre | Uso |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth web / SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | Bot + crons (servidor) |
| `WHATSAPP_TOKEN` | Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID |
| `WHATSAPP_VERIFY_TOKEN` | Verificación webhook |
| `WHATSAPP_APP_SECRET` | Firma HMAC |
| `WHATSAPP_API_VERSION` | Default `v21.0` |
| `GOOGLE_MAPS_API_KEY` | Places / Geocoding / Routes |
| `CRON_SECRET` | Crons Vercel |

### Producto / auth web

| Nombre | Uso |
|--------|-----|
| `NEXT_PUBLIC_SITE_URL` | Redirect Auth + base pública |
| `PRE_LAUNCH_MODE` | `true`/`1`/`yes` → nuevos = PIONEER |

### Referidos (recomendadas)

| Nombre | Uso |
|--------|-----|
| `REFERRAL_PUBLIC_BASE_URL` | Base del link (default `NEXT_PUBLIC_SITE_URL` o `https://whatxia.com`) |
| `WHATSAPP_BUSINESS_PHONE` | E.164 para `wa.me` desde `/r/[code]` |
| `NEXT_PUBLIC_WHATSAPP_PHONE` | Alternativa pública al teléfono de negocio |

### Opcionales

| Nombre | Uso |
|--------|-----|
| `OPENAI_API_KEY` / Whisper vars | Voz |
| `GEO_CITY_*` / `PLACE_CONFIDENCE_THRESHOLD` | Fallback geo |
| `PORT` | Local `3002` |

Plantilla versionada: `.env.example`.

---

## 6. Estado del Operations Center

| Ítem | Estado en BACKUP-002 |
|------|----------------------|
| UI Usuarios | Implementada (`/ops/users`) |
| UI Referidos | No versionada como página dedicada en este corte |
| Datos referidos | Tablas + helpers `getReferralStatsForDriver` / attributions listos para consumir |
| Auth acceso | Supabase Auth (middleware en `/ops`, `/login`, …) |

---

## 7. Estado del Bot

| Entrada | Comportamiento esperado |
|---------|-------------------------|
| `Hola` (no conductor) | Onboarding pasajero / Pionero si aplica |
| `🚖` + conductor registrado | Auth / menú conductor (sin Pionero) |
| Botón **Iniciar sesión** + conductor | Login conductor (sin crear Pionero) |
| Mi cuenta → Referidos | Código + enlace + stats |
| `/r/DRV-XXXXX` | Deep link WhatsApp + pending attribution |

Orquestador único: `src/lib/whatsapp/handler.ts` ← `src/app/api/webhook/route.ts`.

---

## 8. Hotfixes incluidos en este corte

| ID / tema | Descripción |
|-----------|-------------|
| Build `route-favorites/flow.ts` | Restaurar cierre de bloque `if` / `favorites` (sintaxis) |
| REF-003.1 | Referidos fuera del menú principal; early route `🚖` para conductores |
| **HOTFIX prioridad alta** | `Iniciar sesión` / conductor registrado: bypass PRE_LAUNCH y onboarding pasajero; no crear Pionero desde flujo conductor; inscripción `🚖` sin `ensureIdentityOrPrompt` |

---

## 9. Cambios desde BACKUP-001

BACKUP-001 (24 jul 2026, `d8a65d7`, migraciones ≤029) → BACKUP-002 (29 jul 2026, migraciones ≤040).

### Auth y conductores

- Password hash + sesiones WhatsApp (031–032).
- Login / logout / menú cerrado.
- AUTH-002: recuperación web Supabase Auth.
- AUTH-WA-001: reset password por WhatsApp.
- AUTH-WA-002 / DRIVER-004: cambio de número, auditoría, cooldown 30 días.
- Menú jerárquico + rendimiento.
- Validación cédula única; email / tarjeta operación.

### Identidad y UX conversacional

- Sprint 2.x: `preferred_name`, `full_name`, CTA universal.
- UX-001 … UX-004.1: copy pasajero/conductor, menús, llegada personalizada, espaciado.
- ETA automático; mensajes de asignación unificados.

### Pasajeros y pre-lanzamiento

- Favoritos de recorridos; reputación bidireccional.
- USER-001: status PIONEER/BETA/ACTIVE/BLOCKED + Ops Users.
- USER-001.1–001.3: `registered_at`, `registration_source`, copy Pionero, onboarding sin pregunta de marketing.
- Feature flag `PRE_LAUNCH_MODE`.

### Referidos

- REF-003 + REF-003.1: bot, `/r/[code]`, migración 040, tests.

### Infra / calidad

- Migraciones 030–040.
- Hotfixes de enrutamiento conductor vs Pionero y build favorites.

### Commits representativos (orden reciente → antiguo, extracto)

Ver `git log d8a65d7..BACKUP-002 --oneline` en el commit canónico. Incluye entre otros:

- `feat(referrals)`, `fix(driver): separate onboarding…`
- `feat(user-001*)`, `feat(driver-004*)`, `feat(auth*)`, `feat(ux*)`
- Sprints 1.x–2.x (ETA, auth, identidad, favoritos, reputation)

---

## 10. Punto de restauración

### A. Volver exactamente a BACKUP-002 (código)

```bash
git fetch origin
git checkout backup/BACKUP-002
# equivalente:
git checkout c819ded345f1aed6669f74089d661a112f010479
npm install
npx tsc --noEmit
npm run build
```

Verificación del commit:

```bash
git log -1 --oneline
# esperado: c819ded docs(infra): create BACKUP-002 restore point…
```

Para recrear `main` local desde este punto (destructivo — solo con acuerdo del equipo):

```bash
git checkout main
git reset --hard backup/BACKUP-002
```

### B. Restaurar esquema Supabase alineado

1. Proyecto Supabase con migraciones `001`→`040` aplicadas en orden.  
2. Confirmar tablas/columnas de referidos y `passengers.status`.  
3. No reaplicar migraciones ya aplicadas (usar solo las faltantes).

### C. Variables y Meta

1. Completar env en Vercel / `.env.local` según sección 5.  
2. Webhook Meta → `https://<dominio>/api/webhook`.  
3. Redirect URLs Auth: `{SITE_URL}/auth/confirm`, reset password.  
4. `PRE_LAUNCH_MODE` según fase de producto.

### D. Relación con BACKUP-001

- Histórico detallado MVP temprano: `docs/backup/` (Biblia técnica PDF, manual 001–029).  
- **Para recuperar el estado actual de producto, usar siempre BACKUP-002**, no BACKUP-001.

---

## 11. Archivos de este restore point

| Ruta | Contenido |
|------|-----------|
| `docs/backups/BACKUP-002.md` | Este documento |
| `docs/backups/README.md` | Índice de restore points |
| `docs/backups/arbol-BACKUP-002.txt` | Árbol del repo (sin node_modules/.git/.next) |
| `docs/backup/` | Backup integral BACKUP-001 (histórico) |

---

## 12. Principio de seguridad

- Nunca documentar ni versionar valores de secretos.  
- Service role solo en servidor.  
- RLS aún limitado: no exponer keys al cliente.
