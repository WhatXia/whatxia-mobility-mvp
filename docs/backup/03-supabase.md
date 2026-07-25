# 3. Supabase

## Rol en la arquitectura

Supabase es la **fuente de verdad de dominio** (conductores, viajes, sesiones, tarifas, túneles, taxímetro de prueba).

El backend Next.js se conecta con:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (cliente en `src/lib/supabase/client.ts`)

> El código de servidor usa **service role**. No hay flujo de login Supabase Auth para pasajeros/conductores: la identidad es el **teléfono de WhatsApp**.

## Auth

| Tema | Estado |
|------|--------|
| Auth de usuarios finales (email/OAuth) | **No usado** por el MVP WhatsApp |
| Identidad | Teléfono WhatsApp normalizado |
| API keys | Service role en servidor; anon key documentada pero no es el path principal del bot |
| RLS | **No hay políticas RLS creadas en las 29 migraciones** |

**Implicación de seguridad:** las tablas dependen de que las keys no se filtren. El acceso público vía anon sin RLS sería riesgoso; el diseño asume acceso solo desde el backend con service role.

## Storage / Buckets

| Tema | Estado |
|------|--------|
| Buckets Storage | **Ninguno** definido en migraciones |
| Media WhatsApp | Se descarga vía Graph API (`WHATSAPP_TOKEN`); no se persiste en Supabase Storage en este MVP |

## Funciones SQL / Triggers

| Tema | Estado en migraciones |
|------|------------------------|
| `CREATE FUNCTION` | No hay funciones PL/pgSQL de negocio versionadas |
| Triggers | No hay triggers versionados |
| Defaults / constraints | Sí: PK, FK, CHECK de status, índices |

La lógica de negocio vive en TypeScript (`src/lib/**`), no en stored procedures.

## Tablas (inventario)

### Actores

| Tabla | Propósito |
|-------|-----------|
| `drivers` | Conductores: perfil, vehículo, docs, disponibilidad, status, ciudad |
| `passengers` | Pasajeros (alta automática por teléfono) |

### Viajes y operación

| Tabla | Propósito |
|-------|-----------|
| `trips` | Ciclo de vida del servicio + geo + tarifas |
| `trip_cancellations` | Historial de cancelaciones / causales |
| `trip_driver_exclusions` | Conductores excluidos de un trip (reasignación) |

### Conversación

| Tabla | Propósito |
|-------|-----------|
| `conversation_sessions` | Estado FSM por teléfono + drafts |
| `conversation_tunnels` | Túnel P↔D ligado a trip |
| `tunnel_messages` | Mensajes del túnel |

### Documentos

| Tabla | Propósito |
|-------|-----------|
| `document_reminders` | Recordatorios de vencimiento enviados |

### Ciudad / tarifa

| Tabla | Propósito |
|-------|-----------|
| `cities` | Contexto de ciudad (activa: Ibagué) |
| `fare_rules` | **SSoT** parámetros tarifarios por ciudad |
| `holidays` | Festivos nacionales (CO) para recargo |

### Calibración

| Tabla | Propósito |
|-------|-----------|
| `taximeter_test_sessions` | Sesión efímera de prueba (PK teléfono) |
| `taximeter_test_runs` | Corridas de calibración (sin FK a `trips`) |

## Relaciones principales

```
cities 1──* fare_rules
cities 1──* drivers
cities 1──* trips

passengers 1──* trips
drivers 1──* trips (assigned)
trips 1──* trip_cancellations
trips 1──* trip_driver_exclusions
trips 1──* conversation_tunnels
conversation_tunnels 1──* tunnel_messages
drivers 1──* document_reminders
drivers 1──* taximeter_test_runs (nullable)
drivers 1──* taximeter_test_sessions (nullable)
```

- Taxímetro **no** referencia `trips` (independiente de Mobility).  
- `conversation_sessions.phone` es PK (estado conversacional por número).

## Columnas clave recientes en `drivers` (029)

Además del perfil histórico (docs, vehículo, emergencia):

- `email`
- `operation_expires_at` (tarjeta de operación)

Campos de emergencia / `vehicle_year` siguen en esquema (nullable) pero **fuera** del flujo de registro actual.

## Políticas RLS

**Ninguna** política `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` aparece en `supabase/migrations/*`.

Documentar como decisión actual del MVP: seguridad perimetral vía service role + secretos de Vercel, no RLS por fila.

---

## Migraciones 001–029

Aplicar **en orden numérico**. Entorno productivo debe estar al día hasta **029**.

| # | Archivo | Qué hace |
|---|---------|----------|
| 001 | `001_create_drivers.sql` | Crea `drivers` (phone, name, plate, is_available) |
| 002 | `002_create_trips.sql` | Crea `trips` + índices por status/teléfonos |
| 003 | `003_create_passengers.sql` | Crea `passengers`; FK `trips.passenger_id` |
| 004 | `004_driver_full_profile.sql` | Perfil conductor: cédula, dirección, ciudad, emergencia, vehículo, vencimientos docs + flags de bloqueo |
| 005 | `005_conversation_sessions.sql` | FSM conversacional por teléfono |
| 006 | `006_document_management.sql` | `drivers.status`, `document_reminders`, constraints |
| 007 | `007_conversation_tunnels.sql` | `conversation_tunnels` + `tunnel_messages` |
| 008 | `008_tunnel_closing_status.sql` | Status túnel `active` / `closing` / `closed` + índice `closes_at` |
| 009 | `009_trip_cancelled_status.sql` | Status de trip incluye cancelación |
| 010 | `010_cancellations_and_policies.sql` | Contadores/suspensión conductor + tabla `trip_cancellations` |
| 011 | `011_search_and_reassignment.sql` | Deadlines de búsqueda / continuar |
| 012 | `012_trip_driver_exclusions.sql` | Exclusiones conductor↔trip |
| 013 | `013_session_booking_draft.sql` | `booking_draft` JSONB en sessions |
| 014 | `014_trip_geo_and_fare.sql` | Geo pickup/dropoff, distancia, duración, `quoted_fare`, etc. |
| 015 | `015_fare_rules.sql` | Crea `fare_rules` (parámetros comerciales) |
| 016 | `016_fare_increment_80m.sql` | `increment_meters = 80` en reglas activas |
| 017 | `017_city_context.sql` | Tabla `cities` + `city_id` en drivers/trips/fare_rules; seed Ibagué |
| 018 | `018_waiting_flow.sql` | Status `cancelled_no_driver` + contador recordatorios búsqueda |
| 019 | `019_tariff_final_fare.sql` | `started_at`, `finished_at`, `final_fare`, `wait_seconds` |
| 020 | `020_fare_rules_tariff_engine.sql` | Columnas Tariff Engine en `fare_rules` (tiempo, espera, etc.) |
| 021 | `021_sync_ibague_fare_rules_from_seed.sql` | Sync montos Ibagué desde seed histórico |
| 022 | `022_official_ibague_tariffs.sql` | Alinea tarifas oficiales de negocio Ibagué |
| 023 | `023_ibague_night_window_19_to_6.sql` | Nocturno 19:00–06:00 |
| 024 | `024_holidays_colombia.sql` | Tabla `holidays` + seed CO 2025–2027 |
| 025 | `025_taximeter_test.sql` | `taximeter_test_sessions` + `taximeter_test_runs` |
| 026 | `026_taximeter_test_enrichment.sql` | Ruta/polyline/JSON enrichment en taxímetro |
| 027 | `027_taximeter_test_meter_optional.sql` | `meter_value` / diffs opcionales (MVP sin taxímetro físico) |
| 028 | `028_ibague_tariff_v2_increment_90.sql` | `increment_amount = 90` (Ibagué v2) |
| 029 | `029_driver_email_operation_card.sql` | `drivers.email`, `drivers.operation_expires_at` |

### Archivo auxiliar (no numerado)

| Archivo | Notas |
|---------|--------|
| `supabase/APPLY_SPRINT_18.sql` | Script auxiliar histórico de sprint 18; la secuencia canónica son las migraciones numeradas |

## Cómo aplicar migraciones

1. Abrir SQL Editor del proyecto Supabase (o CLI `supabase db push` / `psql` si está configurado).  
2. Ejecutar cada archivo `001` → `029` en orden, o usar el flujo de migraciones del CLI del equipo.  
3. Verificar tablas clave: `drivers`, `trips`, `fare_rules`, `cities`, `holidays`, `taximeter_test_*`.  
4. Confirmar fila activa de `fare_rules` para Ibagué y ciudad activa en `cities`.

## Datos de configuración esperados post-migración

- Ciudad activa: **Ibagué** (`cities.slug` / flags según 017).  
- `fare_rules` activa con parámetros v2 (mínimo, incremento 80 m × $90, nocturno 19–6, surcharges).  
- `holidays` con calendario CO sembrado.

## Pendientes de esquema / ops

- Introducir RLS si se expone anon key a clientes.  
- Panel admin / vistas BI no existen como migraciones.  
- Auth Supabase no requerido para el bot actual.
