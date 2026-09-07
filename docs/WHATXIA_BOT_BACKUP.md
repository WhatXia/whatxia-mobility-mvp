# WhatXia Bot — Backup maestro (capacidad multi-ciudad)

**Fecha:** 7 de septiembre de 2026  
**Repositorio:** WhatXia Bot / POC MVP (`whatxia-mobility-mvp`)  
**Alcance:** bot WhatsApp. No incluye Panel de Control ni Labs.

Este documento **no reemplaza** los restore points históricos:

- [BACKUP-001](./backup/README.md) (24 jul 2026)
- [BACKUP-002](./backups/BACKUP-002.md) (29 jul 2026)

---

## Capacidad multi-ciudad implementada

El bot puede operar **varias ciudades habilitadas a la vez** (p. ej. Ibagué y Pasto) con una sola lógica parametrizada por `city_id`.

Una ciudad nueva se agrega principalmente como **dato** (`cities` + `fare_rules`), no como un fork del bot.

## Arquitectura adoptada

```text
pickup (coords)
   ↓
resolveCityFromPoint()   ← cities.active = true (N simultáneas)
   ↓
trip.city_id
   ↓
pricing  = fare_rules de esa ciudad
dispatch = drivers.city_id = trip.city_id
accept   = driver.city_id === trip.city_id (defensivo)
republish = conserva trip.city_id
```

La ciudad es dato, no código. No existen `dispatchIbagué()` / `pricingPasto()`.

## Fuente de verdad de ciudad

| Concepto | Campo / API | Rol |
|---|---|---|
| Ciudad habilitada | `cities.active` | WhatXia presta servicio ahí. Varias a la vez. |
| Ciudad del viaje | `trips.city_id` | **Fuente operacional** de la solicitud. |
| Ciudad del conductor | `drivers.city_id` | Ciudad en la que opera. |
| Texto de perfil | `drivers.city` | No es fuente operacional. |
| Resolución geo | `resolveCityFromPoint(lat,lng)` | Pickup → ciudad habilitada o rechazo. |

`getActiveCity()` queda **legacy** (launch programs / admin). No decide el universo de un viaje.

`GEO_CITY_LAT/LNG/RADIUS_M` son legacy y no gobiernan booking, Places, dispatch ni tarifas.

## Cambios de dispatch

- `listAvailableDrivers({ cityId })` exige la ciudad del viaje.
- `offerTripToDrivers` resuelve ciudad desde el pickup **antes** de crear el viaje.
- `publishTripOffer` / republish / WaitingFlow reutilizan `trip.city_id`.
- `handleDriverAccept` rechaza si `driver.city_id !== trip.city_id`.
- Un solo dispatch reutilizable.

## Cambios de pricing / geo

- Estimado y tarifa final usan el slug de la ciudad del pickup / `trip.city_id`.
- Places recibe la `City` del servicio (bias + filtro). Ya no llama `getActiveCity()`.
- Pickup y destino del MVP deben estar en **la misma** ciudad habilitada.
- Pickup fuera de cobertura → no se crea viaje.

## Migraciones

| Archivo | Efecto |
|---|---|
| `017_city_context.sql` | Tabla `cities`, `city_id` en drivers/passengers/trips/fare_rules (histórico). |
| **`046_multicity_enabled.sql`** | Quita `cities_one_active_idx`. Inserta **Pasto** habilitada. Índices por `city_id`. |

**Pasto — tarifas comerciales: PENDIENTES.** No se sembró `fare_rules` inventada. Cotizar en Pasto falla cerrado hasta que exista fila activa real.

## Pruebas

```bash
npx tsx src/lib/city.certify.ts
npx tsx src/lib/multicity.certify.ts
```

Cubren: aislamiento Ibagué/Pasto, cross-city dispatch/accept, republish, geo dentro/fuera, pricing por ciudad, ambas habilitadas sin singleton.

## Estado actual

- Código: resolución por pickup + aislamiento por `trip.city_id`.
- DB: aplicar `046` en el proyecto Supabase del bot para habilitar Pasto y permitir N `active=true`.
- Ibagué sigue con `fare_rules` oficiales.
- Un WhatsApp; la ciudad se infiere del pickup.

## Decisiones pendientes (Panel de Control)

El Panel (otro repositorio, posterior) deberá:

1. CRUD de ciudades y `fare_rules` (activar/desactivar, radios, tarifas reales de Pasto).
2. Asignar/mover `drivers.city_id` (el bot solo lo setea al registrar vía hint de nombre de ciudad).
3. Estado operativo / mantenimiento **por ciudad** (hoy `bot_operational_status` es global).
4. Launch programs por `city_id` (hoy usan `getActiveCity()` legacy).
5. Favoritos con `city_id` explícito.
6. Política de teléfono único global vs un conductor en dos ciudades.

No hay endpoints ni UI de ciudades en este sprint.
