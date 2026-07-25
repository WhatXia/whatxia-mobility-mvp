# 7. Manual de recuperación

Objetivo: reconstruir WhatXia Mobility MVP **desde cero** usando solo GitHub, Vercel, Supabase, variables de entorno, migraciones y configuración Meta.

Tiempo estimado (persona familiarizada): 2–4 horas + propagación DNS/Meta.

---

## 0. Prerrequisitos

- Cuenta GitHub con acceso a `WhatXia/whatxia-mobility-mvp` (o un fork).  
- Cuenta Vercel con permiso para crear proyectos y Cron Jobs.  
- Proyecto Supabase (nuevo o vacío).  
- App Meta / WhatsApp Cloud API con número de prueba o producción.  
- API key Google Maps Platform (Places New, Geocoding, Routes habilitados).  
- (Opcional) API key OpenAI para voz.  
- Node.js LTS compatible con Next 16 + npm.

---

## 1. Clonar el repositorio

```bash
git clone https://github.com/WhatXia/whatxia-mobility-mvp.git
cd whatxia-mobility-mvp
git checkout main
git pull origin main
npm install
```

Verificar commit de referencia (opcional):

```bash
git log -1 --oneline
# esperado en el corte del backup: d8a65d7 …
```

---

## 2. Crear / preparar Supabase

1. Crear proyecto en https://supabase.com.  
2. Copiar:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**secreto**)
3. Abrir **SQL Editor**.  
4. Aplicar migraciones en orden:

```text
supabase/migrations/001_create_drivers.sql
… hasta …
supabase/migrations/029_driver_email_operation_card.sql
```

Ejecutar **una por una** (o automatizar con Supabase CLI si el equipo lo usa). No saltar números.

5. Verificaciones post-migración:

```sql
-- Tablas clave
select tablename from pg_tables where schemaname = 'public' order by 1;

-- Ciudad / tarifas
select slug, name from public.cities;
select city_id, active, flag_drop, minimum_fare, increment_meters, increment_amount,
       night_start_hour, night_end_hour
from public.fare_rules where active = true;

-- Festivos
select count(*) from public.holidays where country_code = 'CO';

-- Columnas registro
select column_name from information_schema.columns
where table_name = 'drivers' and column_name in ('email', 'operation_expires_at');
```

6. Auth / Storage: **no se requieren** para el bot actual.  
7. RLS: no hay políticas en migraciones; **no exponer** la service role al cliente.

Detalle de cada migración: [03-supabase.md](./03-supabase.md).

---

## 3. Variables de entorno (local)

Copiar plantilla:

```bash
cp .env.example .env.local
```

Completar **valores** (nunca commitear `.env.local`):

| Nombre | Obligatorio prod |
|--------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Recomendado |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí |
| `WHATSAPP_TOKEN` | Sí |
| `WHATSAPP_PHONE_NUMBER_ID` | Sí |
| `WHATSAPP_VERIFY_TOKEN` | Sí |
| `WHATSAPP_APP_SECRET` | Sí |
| `WHATSAPP_API_VERSION` | No (default `v21.0`) |
| `GOOGLE_MAPS_API_KEY` | Sí (booking/dispatch/tarifa) |
| `CRON_SECRET` | Sí (crons) |
| `OPENAI_API_KEY` (+ whisper vars) | Solo si se quiere voz |
| `GEO_CITY_*` / `PLACE_CONFIDENCE_THRESHOLD` | Fallback; SSoT ciudad en DB |

Probar local:

```bash
npm run dev
# Webhook local: app en puerto 3002; túnel → http://localhost:3002/api/webhook
# cloudflared tunnel --url http://localhost:3002
# ngrok http 3002
```

---

## 4. Desplegar en Vercel

1. **Add New Project** → Importar `WhatXia/whatxia-mobility-mvp`.  
2. Framework: Next.js (autodetect).  
3. Root: `/`.  
4. Configurar **Environment Variables** (Production; y Preview si aplica) con los mismos nombres de la tabla anterior.  
5. Deploy.  
6. Confirmar que `vercel.json` registró crons:
   - `/api/cron/documents` — `0 13 * * *`
   - `/api/cron/tunnels` — `5 13 * * *`
7. Anotar dominio de producción: `https://<proyecto>.vercel.app` o custom domain.  
8. Probar build logs: `next build` sin errores.

Detalle: [02-vercel.md](./02-vercel.md).

---

## 5. Configurar Meta (WhatsApp Cloud API)

1. En Meta Developers → App → WhatsApp → **Configuration**.  
2. Webhook callback URL:

```text
https://<dominio-produccion>/api/webhook
```

3. Verify token = valor de `WHATSAPP_VERIFY_TOKEN` (exacto).  
4. Suscribir campo **`messages`**.  
5. Copiar a Vercel:
   - Temporary/Permanent token → `WHATSAPP_TOKEN`
   - Phone number ID → `WHATSAPP_PHONE_NUMBER_ID`
   - App Secret → `WHATSAPP_APP_SECRET`
6. Redeploy Vercel tras guardar env vars.  
7. Enviar mensaje de prueba “Hola” al número Business desde un WhatsApp permitido (modo prueba: números en allowlist).

Detalle: [04-whatsapp-meta.md](./04-whatsapp-meta.md).

---

## 6. Google Maps

1. Proyecto GCP con billing.  
2. Habilitar: Places API (New), Geocoding API, Routes API.  
3. Restringir la key por IP/referrer según política del equipo (en Vercel suele ser restricción por API + cuotas).  
4. Pegar en `GOOGLE_MAPS_API_KEY`.

---

## 7. Smoke test de recuperación (checklist)

### Pasajero

- [ ] “Hola” → menú solicitar servicio.  
- [ ] Flujo origen → destino → cotización con rango.  
- [ ] Confirmar → “buscando conductor” (aunque no haya drivers).  

### Conductor

- [ ] Registrar conductor nuevo (`🚖` / intención) → Continuar → completar campos → mensaje final de recepción.  
- [ ] Verificar fila en `drivers` (incluye `email`, `operation_expires_at`).  
- [ ] Marcar disponible → pedir viaje con otro número → recibir oferta → aceptar → iniciar → finalizar.  
- [ ] Verificar mensajes de fin (rango estimado + $800), no “Tarifa final”.  

### Ops

- [ ] Cron documents responde 401 sin `CRON_SECRET` y 200 con secreto.  
- [ ] Logs Vercel sin errores de firma WhatsApp.  
- [ ] `fare_rules.increment_amount = 90` para Ibagué.  

### Voz (opcional)

- [ ] Nota de voz → texto → mismo flujo que texto.

---

## 8. Restaurar solo base de datos (desastre parcial)

Si el código en Vercel está bien pero se perdió la DB:

1. Crear proyecto Supabase nuevo.  
2. Reaplicar migraciones 001–029.  
3. Actualizar URL/keys en Vercel.  
4. Redeploy.  
5. Re-sembrar datos operativos (conductores piloto) — **no** hay dump automático en este repo; exportar periódicamente `drivers` / `fare_rules` / `holidays` como backup de datos.

Si se perdió solo `fare_rules`/`holidays`, re-ejecutar migraciones 021–024 y 028 (cuidado: updates idempotentes en su mayoría).

---

## 9. Restaurar solo el bot (código)

1. Reimportar repo en Vercel o `git push` a `main`.  
2. Reusar mismas env vars.  
3. No reaplicar migraciones salvo que el nuevo código exija esquema mayor (hoy: ≤029).

---

## 10. Lo que este manual NO reconstruye solo

| Elemento | Acción humana |
|----------|----------------|
| Números WhatsApp allowlist / WABA producción | Meta Business Manager |
| Dominio custom + DNS | Vercel Domains + registrar |
| Histórico de viajes / corridas taxímetro | Backup SQL externo (no automatizado aquí) |
| Secretos históricos rotados | Regenerar tokens Meta/Supabase/Google/OpenAI |
| Aprobaciones de conductores pendientes | Proceso de negocio |

---

## 11. Orden mental de dependencia

```
GitHub (código)
  → npm install / Vercel build
Supabase (schema 001–029 + keys)
  → env en Vercel
Meta webhook → /api/webhook
Google Maps key
  → booking + tariff + dispatch
(Opcional) OpenAI
  → voz
Smoke test E2E
```

Con esos bloques, cualquier desarrollador puede recuperar el MVP **sin el contexto de chats previos**, usando únicamente este directorio `docs/backup/` y los secretos del equipo.
