# 2. Vercel

## Proyecto conectado

| Campo | Valor documentado |
|-------|-------------------|
| Repo Git | `WhatXia/whatxia-mobility-mvp` |
| Framework | Next.js (App Router) |
| Directorio raíz | `/` (monorepo no aplica) |
| Rama de producción esperada | `main` |
| CLI Vercel en entorno de auditoría | **No disponible** (`vercel` CLI ausente) |

> Los nombres exactos del proyecto en el dashboard, team ID y dominios custom **deben confirmarse en** https://vercel.com (Project Settings). Este backup documenta lo inferible desde el repositorio y la configuración versionada.

## Build y runtime

| Setting | Valor |
|---------|--------|
| Install | `npm install` (default Vercel) |
| Build Command | `next build` (`package.json` → `build`) |
| Output | Next.js (Vercel adapter automático) |
| Node | Compatible con Next 16 (entorno local auditado: Node `v24.18.0`; en Vercel usar LTS soportada por Next 16) |
| `next.config.ts` | Config vacía (defaults) |

## Crons (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/cron/documents", "schedule": "0 13 * * *" },
    { "path": "/api/cron/tunnels", "schedule": "5 13 * * *" },
    { "path": "/api/cron/launch-programs", "schedule": "* * * * *" }
  ]
}
```

| Path | Schedule (UTC) | Propósito |
|------|----------------|-----------|
| `/api/cron/documents` | `0 13 * * *` | Recordatorios / bloqueo docs conductores |
| `/api/cron/tunnels` | `5 13 * * *` | Cierre de túneles conversacionales vencidos |
| `/api/cron/launch-programs` | `* * * * *` | BUG-PIONEERS-003: cierra programas vencidos + drena WhatsApp |

También existe `/api/cron/search` (timeouts de búsqueda). **No** está registrado en `vercel.json`; el timeout también se dispara al recibir webhooks vía `processDueSearchTimeouts()`.

> Requiere plan Vercel que permita cron cada minuto. Si el plan no lo permite, el cierre también corre lazy en cada webhook WhatsApp (`processDueLaunchProgramClosures`).

Los crons validan `CRON_SECRET` (header/query según implementación de cada route).

## Dominios

| Tipo | Estado en backup |
|------|------------------|
| Dominio `*.vercel.app` | Asignado por Vercel al proyecto (confirmar en Dashboard → Domains) |
| Dominio custom | No versionado en repo; confirmar en Dashboard |
| Webhook Meta | Debe apuntar a `https://<dominio-produccion>/api/webhook` |

## Variables de entorno (solo nombres)

### Documentadas en `.env.example`

| Nombre | Uso |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (presente en example; el runtime usa service role) |
| `SUPABASE_SERVICE_ROLE_KEY` | Acceso servidor (bypass RLS) |
| `WHATSAPP_TOKEN` | Token Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID |
| `WHATSAPP_VERIFY_TOKEN` | Verificación webhook GET |
| `WHATSAPP_APP_SECRET` | Firma HMAC `X-Hub-Signature-256` |
| `WHATSAPP_API_VERSION` | Default `v21.0` |
| `OPENAI_API_KEY` | Whisper (voz) |
| `OPENAI_WHISPER_MODEL` | Default `whisper-1` |
| `OPENAI_WHISPER_LANGUAGE` | Default `es` |
| `VOICE_TRANSCRIPTION_PROVIDER` | Default `openai_whisper` |
| `CRON_SECRET` | Autenticación de crons |
| `GOOGLE_MAPS_API_KEY` | Places / Geocoding / Routes |
| `GEO_CITY_LAT` | Fallback bias ciudad |
| `GEO_CITY_LNG` | Fallback bias ciudad |
| `GEO_CITY_RADIUS_M` | Fallback radio |
| `PLACE_CONFIDENCE_THRESHOLD` | Umbral Places |

### Nombres observados en `.env.local` local (sin valores)

Además de un subconjunto de las anteriores:

| Nombre | Notas |
|--------|--------|
| `MOBILITY_ROUTE_PROVIDER` | Presente en local; **no** está en `.env.example` — confirmar si se usa en prod |

### Variables de plataforma Vercel (inyectadas)

| Nombre | Uso |
|--------|-----|
| `VERCEL` | Detectado en `geo/config` |
| `VERCEL_ENV` | `production` / `preview` / `development` |
| `NODE_ENV` | Runtime Node |

**Nunca versionar valores.** En Vercel: Project → Settings → Environment Variables (Production / Preview / Development según corresponda).

## Estado actual (según repo)

- Deploy esperado: cada push a `main` (si está conectado el Git Integration).
- Funcionalidad productiva: webhook WhatsApp + crons documentos/túneles.
- Landing web no es el producto; health del sistema = logs de `/api/webhook` y Supabase.

## Checklist ops Vercel

1. Proyecto vinculado al repo GitHub correcto.  
2. Todas las variables de la tabla (excepto opcionales de voz/geo fallback) configuradas en **Production**.  
3. Crons activos (plan Vercel que soporte Cron Jobs).  
4. Dominio de producción pegado en Meta webhook.  
5. Redeploy tras cambiar env vars.
