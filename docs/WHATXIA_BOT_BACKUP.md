# WhatXia Bot — Documento maestro (estado real del repositorio)

**Fecha de verificación:** 7 de septiembre de 2026  
**Repositorio:** `whatxia-mobility-mvp` (WhatXia Bot / POC MVP)  
**Método:** lectura del código actual. No describe intención de producto. Describe lo que el código hace hoy.

Este documento **no reemplaza** los restore points históricos:

- [BACKUP-001](./backup/README.md) (24 jul 2026)
- [BACKUP-002](./backups/BACKUP-002.md) (29 jul 2026)

Uso previsto: conocimiento maestro del GPT WhatXia Bot CTO. Separar de WhatXia Operations Panel (producto) y WhatXia Labs.

---

## Identidad de este repositorio

Este repo **no es solo el Bot**. Hoy contiene:

| Superficie | ¿Está en este repo? | Qué es realmente |
|---|---|---|
| **WhatXia Bot** | Sí — núcleo | WhatsApp Cloud API → webhook → booking/dispatch/trips |
| **Ops embebido** | Sí — delgado | UI `/ops` + auth web. No es el Panel de Control de producto |
| **WhatXia Operations Panel** | No | Producto separado (fuera de este repo) |
| **WhatXia Labs** | No | No hay código Labs. El Bot **consume** tablas CMS (`bot_messages`, árboles) que Labs/otro proyecto se espera que cree |

El home `/` (`src/app/page.tsx`) es el starter de Next.js. No es la UI de movilidad.

---

## 1. ¿Qué es exactamente WhatXia Bot?

WhatXia Bot es un **orquestador conversacional de movilidad urbana por WhatsApp**, hospedado como Next.js (puerto local **3002**, Vercel en producción).

No hay app nativa de pasajero ni de conductor. Un único número de WhatsApp Business atiende ambos roles.

**Entrada**

| Ruta | Función |
|---|---|
| `GET /api/webhook` | Verificación Meta (`WHATSAPP_VERIFY_TOKEN`) |
| `POST /api/webhook` | Firma HMAC `x-hub-signature-256` (`WHATSAPP_APP_SECRET`) → parse → (audio→Whisper) → `handleIncomingMessage` |

El webhook **siempre responde 200** `{ ok: true }` después de procesar, para que Meta no reintente en bucle.

**Orquestador:** `src/lib/whatsapp/handler.ts` → `handleIncomingMessage`.  
**Salida:** `src/lib/whatsapp/client.ts` → Graph API `/{PHONE_NUMBER_ID}/messages` (texto, botones, ubicación, location-request, CTA URL). Versión por defecto `v21.0`.

Antes de enrutar cada mensaje inbound:

1. `processDueSearchTimeouts()` (WaitingFlow)
2. `processDueLaunchProgramClosures()`
3. `drainLaunchOutboundQueue(25)` (fire-and-forget)
4. Gate de mantenimiento (`handleMaintenanceIfNeeded`)

---

## 2. ¿Qué funcionalidades están realmente operativas hoy?

Operativas en código (happy path Ibagué, con las salvedades de la matriz):

- Webhook WhatsApp (texto, botones, ubicación, voz→texto)
- Booking pasajero: texto de origen + GPS WhatsApp + destino Places + cotización + Solicitar
- Creación de `trips` con `city_id` resuelto del pickup
- Dispatch 1:1 a conductores disponibles de **esa** ciudad
- Ciclo de viaje: accept → ETA automático → Llegué → Iniciar → Navegar → Finalizar
- WaitingFlow 2+2+2 min y `cancelled_no_driver`
- Cancelación pasajero; cancelación conductor con causal + republish
- Túnel pasajero↔conductor
- Registro / login por contraseña / menú de conductor / documentos / cambio de teléfono
- Tarifas Ibagué desde `fare_rules` (estimado + final)
- CMS: lectura `bot_messages` PUBLISHED + fallback catálogo en código
- Pioneros (`launch_programs`) y referidos (tracking, sin payout)
- Mantenimiento global
- Favoritos de recorrido (máx. 2)
- Rating pasajero→conductor y conductor→pasajero
- Crons: documentos, túneles, launch-programs
- Telemetría OwnTracks (ingesta independiente del viaje)

Operativas con excepciones:

- **Pasto:** publicar viaje sin tarifa (booking). **No** finalizar tarifa.
- **Ops `/ops`:** cuatro pantallas; no es Panel de producto.

No operativas / no presentes:

- WhatXia Labs
- CRUD de ciudades / `fare_rules` en UI
- Mantenimiento por ciudad
- Pago / wallet / payout de referidos
- App nativa

---

## 3. Flujo completo de pasajero

### Acceso

Estados en `passengers.status`: `PIONEER | BETA | ACTIVE | BLOCKED`.  
Puede pedir servicio: **solo `ACTIVE` y `BETA`** (`canPassengerRequestService`).

Si el programa Pioneros acepta registros, un usuario nuevo (no conductor) entra a onboarding de identidad, **salvo** que entre por Solicitar / intent de servicio. El nombre puede capturarse después del GPS (`WAITING_BOOKING_NAME`).

Un conductor registrado **no** pasa por onboarding Pionero (hotfix temprano en el handler).

### Camino de solicitud (hoy `BOOKING_REQUIRE_DROPOFF = true`)

Captura de origen: `ORIGIN_CAPTURE_MODE = "label_plus_whatsapp_location"`. El texto es etiqueta; el punto exacto es el pin de WhatsApp. Places **no** resuelve el pickup.

```text
intent / menú Solicitar
  → WAITING_PICKUP_TEXT     texto barrio/dirección → etiqueta
  → WAITING_PICKUP_LOCATION pin WhatsApp obligatorio
       resolveCityFromPoint(pickup) → ciudad o rechazo de cobertura
  → WAITING_BOOKING_NAME    si no hay nombre
  → WAITING_DROPOFF_TEXT    Places en la ciudad del pickup
       alta confianza → cotización
       2–3 candidatos → WAITING_DROPOFF_CONFIRM
       no encontrado → mapa o reescribir
  → WAITING_QUOTE_CONFIRM
       Ibagué: estimateRoute + estimateFare + rango COP
       Pasto (slug === "pasto"): sin estimateFare; confirmación sin dinero
  → Solicitar (booking_request_trip)
       launchTripFromDraft → offerTripToDrivers
  → sesión SEARCHING_DRIVER
```

Destino debe estar en **la misma** ciudad habilitada que el pickup.

### Tras publicar

El pasajero ve búsqueda. Si hay conductor: vehículo + ETA + Cancelar. En `DRIVER_ARRIVED`: Ya voy / Cancelar. “Ya voy” solo notifica; **no cambia** el status del trip. Al completar: mensaje + rating (`rating:5|4|2:{tripId}`) + oferta de favorito / menú.

### Fallos típicos de booking

- Pickup fuera de cualquier `cities.active` → no se crea viaje
- Destino otra ciudad → rechazo
- Places vacío → mapa o reintento
- Ibagué: error Routes/tarifa → `P_QUOTE_ROUTE_ERROR`, no publica
- Draft incompleto al pulsar Solicitar → “cotización expirada” + limpia sesión
- Cero conductores disponibles al publicar → copy sin conductores; **el trip no se crea**

---

## 4. Flujo completo de conductor

### Entrada

Frases (`soy conductor`, `modo conductor`, …) o emoji `🚖`/`🚕` al inicio → `isDriverIntent` → `routeDriverModuleEntry`.

- Sin fila en `drivers` → inscripción
- Con fila → login / menú (si ya autenticado)

### Inscripción (`src/lib/driver-registration.ts`)

Orden de campos: `document_id`, `name`, `email`, `address`, `city`, `plate`, `vehicle_brand`, `vehicle_model`, `vehicle_color`, `soat_expires_at`, `techno_expires_at`, `operation_expires_at`, `license_expires_at`. Teléfono = WhatsApp.

`city` de texto se mapea a `drivers.city_id` con `matchCityByHint` contra ciudades habilitadas (slug o nombre). Si no matchea, **no crea** el conductor.

Luego password hash → conductor `active`.

### Auth (`src/lib/driver-auth.ts`)

Login **solo por contraseña**. `DRIVER_LOGIN_DOCUMENT` se reconoce y redirige a password (legacy). Reset: documento → password nueva. Tras auth: nombre preferido opcional → menú.

### Menú (`src/lib/driver-menu.ts`)

Máximo 3 botones WhatsApp por pantalla: Disponibilidad / Mi cuenta / Cerrar sesión. Disponibilidad bloqueada si documentos vencidos.

### Ciclo de servicio (`src/lib/dispatch.ts`)

| Acción | Botón | Transición |
|---|---|---|
| Aceptar | `aceptar_servicio:{tripId}` | `SEARCHING` → `ASSIGNED`; abre túnel; ETA auto; marca no disponible |
| Rechazar | `rechazar_servicio:{tripId}` | No cambia trip |
| ETA manual | `eta:{5\|7\|10}:{tripId}` | Legacy; el camino primario es automático |
| Ver ubicación | `ver_ubicacion:{tripId}` | CTA Maps al pickup |
| Llegué | `llegue:{tripId}` | `ETA_INFORMED` → `DRIVER_ARRIVED` |
| Iniciar | `iniciar_viaje:{tripId}` | `DRIVER_ARRIVED` → `IN_PROGRESS` (sin aviso al pasajero) |
| Navegar | `navegar_destino:{tripId}` | CTA Maps al destino |
| Finalizar | `finalizar_viaje:{tripId}` | `IN_PROGRESS` → `COMPLETED` vía `finalizeFare` |

ETA automático (`src/lib/eta-auto.ts`): ≤60 s desde `created_at` → 5–7 min; si no → 7–10. Persiste `maxMinutes`.

Elegibilidad oferta: `is_available`, no `documents_blocked`, `status=active`, `city_id` = `trip.city_id`, no teléfono del pasajero, no exclusiones, no suspensión vigente.

### Documentos

Tipos: SOAT, tecnomecánica, tarjeta de operación, licencia. Recordatorios 30/15/7/1 días. Vencido → bloquea disponibilidad / `inactive`. Actualización por flujo de documentos vencidos.

### Cambio de teléfono

Documento → password → número nuevo → confirmación en el WhatsApp nuevo. Cooldown 30 días.

---

## 5. Booking, dispatch, trips, search, waiting, tunnels, cancellations

### Booking — `src/lib/booking/flow.ts`

Punto de cotización: `buildAndSendQuote`.  
Punto de publicación: `launchTripFromDraft` → `offerTripToDrivers`.

Excepción **solo Pasto**:

- `PASTO_CITY_SLUG = "pasto"`
- `requiresFareQuote(slug)` → `false` únicamente si slug (trim, lower) es `pasto`
- Publicar: pickup + dropoff. Ibagué (y cualquier otra ciudad): pickup + dropoff + route + quote

No es un bypass global de cotización.

### Dispatch — `src/lib/dispatch.ts`

1. Resuelve ciudad del pickup (`resolveCityFromPoint`) **antes** de crear el viaje
2. `createTrip` asigna `trips.city_id`
3. `listAvailableDrivers({ cityId })` filtra SQL por `drivers.city_id`
4. `handleDriverAccept` rechaza si `driver.city_id !== trip.city_id`
5. Republish / WaitingFlow reutilizan `trip.city_id` (no re-resuelven a otra ciudad)

Oferta al conductor: si `quoted_fare` es null muestra `—` en min/max (no $0).

### Trips — `src/lib/trips.ts`

`createTrip` **exige** lat/lng de pickup. Sin ciudad habilitada que cubra el punto → throw, no inserta.

`quoted_fare` es nullable: solo se escribe si `geo.quotedFare != null`.

Estados de trip:

`SEARCHING` → `ASSIGNED` → `ETA_INFORMED` → `DRIVER_ARRIVED` → `IN_PROGRESS` → `COMPLETED`  
también `CANCELLED`, `cancelled_no_driver`

### Search / WaitingFlow — `src/lib/waiting-flow.ts` (`search.ts` es reexport)

```
SEARCH_WINDOW_MS        = 2 min
CONTINUE_WINDOW_MS      = 2 min
MAX_SEARCH_REMINDER_COUNT = 2
```

t=0 SEARCHING → t=2 min prompt 1 → continuar reinicia 2 min → t=4 min prompt 2 → t=6 min o sin respuesta → `cancelled_no_driver`.  
Continuar = `republishTripToDrivers` (mismo `trip_id` y `city_id`).

El timeout también corre **lazy** en cada webhook. Existe `GET /api/cron/search` pero **no** está en `vercel.json`.

### Tunnels — `src/lib/tunnels.ts`

Estados: `active | closing | closed`. Abre al aceptar. Relé de texto; pin de ubicación. No relé si el trip está SEARCHING / CANCELLED / COMPLETED.

Al finalizar: `scheduleTunnelClose` **5 minutos** (`CLOSE_AFTER_MS`). Un comentario viejo de “20 min” está obsoleto. Cancelar cierra el túnel de inmediato.

### Cancellations — `src/lib/cancellations.ts`

- Pasajero: cancela trip, cierra túnel, limpia sesión. Sin causales.
- Conductor Cancelar → menú: `problema_mecanico` | `cliente_no_recogido` | `no_puedo_llegar`. **No mata el viaje:** `returnTripToSearching` + excluye a ese conductor + republish.
- Mecánico / no puedo llegar: contador; aviso en 2; suspensión **8 h** en ≥3 (`SUSPENSION_MS`).
- No-show del cliente: incrementa `passengers.no_show_count`.

---

## 6. Sistema de tarifas

**SSoT runtime:** `public.fare_rules` vía `loadCityTariffConfig(citySlug)` (`src/lib/tariff/config-loader.ts`). Fail-closed: sin fila activa para el slug → error. **No** cae a archivos seed.

API pública (`src/lib/tariff/engine.ts`):

- `estimateFare` — booking Ibagué
- `finalizeFare` — `handleDriverFinalizarViaje` (y taxímetro de prueba)

Fórmula (`calculateTariff`): mínima + ticks de distancia sobre `min_distance_meters` + tiempo + espera + recargos (noche, domingo/festivo, aeropuerto, plataforma).

- Recargo plataforma (`surcharge_whatxia`) **no** entra en el estimado (`APPLY_CALL_SURCHARGE_ON_ESTIMATE = false`); sí en la tarifa final
- Festivos: tabla `holidays`, no `fare_rules.holiday_dates`
- UI de estimado: rango `amount … amount + 3000` (`ESTIMATED_FARE_RANGE_MARGIN_COP`)
- Copy de pasajero aún dice “más $800 por solicitud” (hardcode de presentación, alineado a Ibagué)

**Ibagué (DB, migraciones 015→028), valores efectivos:**

| Param | Valor |
|---|---|
| flag_drop | 4500 |
| minimum_fare | 6600 |
| min_distance_meters | 1600 |
| increment | 80 m / **90** COP (migración 028) |
| espera | 40 s / 90 |
| noche | 1000 (19→6) |
| domingo/festivo | 850 |
| aeropuerto Perales | 6500, radio 2500 m |
| plataforma | 800 |

**Pasto:** no hay `fare_rules`. Booking salta `estimateFare`. `finalizeFare` **no** está exceptuado → al Terminar viaje el motor falla y el conductor recibe `D_FINAL_FARE_ERROR`; el trip no queda `COMPLETED`.

Seeds `src/lib/tariff/city-config/{ibague,pasto,medellin}.ts` y `registry.ts` están **deprecated**. El engine no los carga. Pasto/Medellín seed = ceros (placeholder). Medellín **no** tiene fila en `cities`.

`src/lib/pricing/*` es capa legacy que delega al tariff engine. `getActiveFareRules()` **lanza** si hay ≠1 ciudad habilitada.

---

## 7. Geolocalización y Google Maps

Archivos: `src/lib/geo/{places,routes,geocoding,client,maps-url,confidence,config,types}.ts`.

| API | Uso |
|---|---|
| Places API (New) `places:searchText` | Destino. `locationBias.circle` = centro+radio de la fila `cities`. Query enriquecida `"{q}, {name}, {region}"`. Filtro local `isPointInCity` |
| Routes `computeRoutes` | Distancia/duración. `TRAFFIC_AWARE` con fallback `TRAFFIC_UNAWARE`. Modo `DRIVE` |
| Geocoding | Reverse geocode |
| URLs Maps | CTA “ver pickup / navegar destino” |

Env operativo: `GOOGLE_MAPS_API_KEY` (obligatoria). Timeout fetch 8 s.

`GEO_CITY_LAT` / `GEO_CITY_LNG` / `GEO_CITY_RADIUS_M` existen en `.env.example` y en `getCityBias()` / `getCityRadiusMeters()`, **sin callers** en `src/`. Defaults de esos helpers = centro Ibagué 4.4389, -75.2322 / 18000 m. **No gobiernan** booking, Places, dispatch ni tarifas.

Pickup y dropoff por pin WhatsApp: parser en `webhook-parser.ts`. Fuera de cobertura: “WhatXia no opera en esta zona.” Destino otra ciudad: “El destino debe estar dentro de {name}.”

Confianza Places: `PLACE_CONFIDENCE_THRESHOLD` (default 0.75).

---

## 8. Arquitectura multiciudad

Fuente operacional del viaje: **`trips.city_id`**, resuelto de las coords de pickup con `resolveCityFromPoint()`.

```text
pickup (lat,lng)
  → listEnabledCities()     cities.active = true (N simultáneas, cache 60 s)
  → resolveCityFromPoint    haversine ≤ radius; si solape, radio más pequeño
  → trips.city_id
  → dispatch: drivers.city_id = trip.city_id
  → accept: mismo match (fail-closed si falta cualquiera)
  → republish: conserva trip.city_id
  → pricing: fare_rules del slug de esa ciudad (si existe fila)
```

`getActiveCity()` es **legacy**: 0 ciudades → throw; 1 → esa; N → warning y **primera por slug**. No debe usarse para trip/dispatch/tarifa. Hoy aún lo usa **city-launch de Pioneros**.

`drivers.city` (texto de perfil) no es fuente operacional. `drivers.city_id` sí.

`passengers.city_id` se puede setear al registrar; **no** decide el universo del viaje.

Pickup y destino del MVP deben estar en la **misma** ciudad habilitada.

Migración `046_multicity_enabled.sql`: quita `cities_one_active_idx`, inserta Pasto, índices por `city_id`.

---

## 9. Qué existe hoy para Ibagué

- Fila `cities`: slug `ibague`, Tolima, centro `4.4389,-75.2322`, radio **18 km**, `active=true` (migración 017)
- `fare_rules` oficiales activas (cadena 015–028)
- Aeropuerto Perales en reglas
- Booking completo: Routes + estimado + rango + `quoted_fare`
- Finalize fare al terminar
- Places sesgado a Ibagué, Tolima
- Backfill histórico de drivers/passengers/trips/fare_rules a Ibagué (017)
- Copy CMS y catálogo escritos para el piloto Ibagué (p. ej. $800 en el estimado)
- Defaults legacy `GEO_CITY_*` = Ibagué (no usados)

Ibagué es el **camino por defecto** del código (cualquier ciudad que no sea slug `pasto`).

---

## 10. Qué se ha implementado para Pasto

- Fila `cities`: slug `pasto`, Nariño, centro `1.2136,-77.2811`, radio **20 km**, `active=true` (046)
- **No** hay `fare_rules` (explícito en 046: no inventar tarifas)
- Booking: `requiresFareQuote("pasto") === false`
  - no llama `estimateFare`
  - conserva pickup + dropoff
  - `estimateRoute` es best-effort (si falla, igual confirma)
  - `buildPastoConfirmBody` sin `$` ni COP
  - `quote` se limpia del draft; `quoted_fare` queda `null`
- `launchTripFromDraft`: publica con pickup + dropoff
- Dispatch ya existente: ofrece a drivers con `city_id` Pasto; oferta con `—`
- Places sesgado a Pasto, Nariño si el pickup resolvió Pasto
- Registro conductor: hint `"Pasto"` → `city_id` Pasto
- Seed `city-config/pasto.ts`: ceros, no runtime

**No implementado para Pasto:** tarifa comercial, skip de `finalizeFare`, copy CMS específico (el confirm está inline en `flow.ts`), UI de Panel, drivers sembrados por migración.

---

## 11. Qué tendría que cambiar para abrir una tercera ciudad

**Mínimo (dato, sin fork de dispatch):**

1. `INSERT` en `cities` (slug, name, region, country_code, center, radius, `active=true`)
2. `INSERT` `fare_rules` activa para ese `city_id` (si la ciudad debe cotizar y finalizar)
3. Asignar `drivers.city_id` a esa ciudad (registro por hint de nombre, o Panel futuro)
4. Festivos: si `country_code=CO`, ya usa `holidays`

**Código que hoy impide “solo dato”:**

- Si la tercera ciudad debe publicar **sin** tarifa: hay que generalizar o no reutilizar `PASTO_CITY_SLUG` (hoy el skip es exclusivo de `"pasto"`)
- Si debe cotizar: no tocar ese hardcode; necesita `fare_rules`
- City-launch Pioneros usa `getActiveCity()` → con N ciudades el mensaje de lanzamiento se atribuye a la **primera slug** (hoy `ibague` gana alfabéticamente sobre `pasto`)
- Mantenimiento es global, no por ciudad
- Favoritos no tienen `city_id`
- Copy `$800` / Perales / textos Ibagué en catálogo CMS
- Seed Medellín existe como fixture y **no** abre Medellín

No hace falta `GEO_CITY_*`. No hace falta un `dispatchMedellin()`.

---

## 12. Pioneros y lanzamientos

Código: `src/lib/launch-programs/*`. Programa: `PIONEERS_USERS`.

Tablas: `launch_programs`, `launch_program_activation_runs`, `launch_program_outbound_messages`, `launch_program_city_launches`.

`PRE_LAUNCH_MODE` env está **ignorado**. Fuente: fila DB (`is_active`, ventana `starts_at`/`ends_at`, `max_quota`).

`computeAcceptsNewPioneers`: activo + dentro de ventana + bajo cupo. Si acepta → pasajeros nuevos `PIONEER`; si no → `ACTIVE`.

Cierre (`closeLaunchProgram`, cron o botón Ops): activa pioneros a ACTIVE y dispara city-launch WhatsApp (`CITY_LAUNCH_MESSAGE` vía CMS). Auditoría `city_id`/`city_name` = `getActiveCity()` (legacy).

Ops: `/ops/marketing/programas/pioneros` (lectura) y desactivar desde `/ops/users`.

No hay filtro de cupo por ciudad en la decisión de registro.

---

## 13. Referidos

Código: `src/lib/referrals/{index,codes,bot}.ts`.

- Código `DRV-XXXXX` en `drivers.referral_code`
- Share canónico: `wa.me/<business>?text=REF%20DRV-XXXXX`
- Teléfono: `WHATSAPP_BUSINESS_PHONE` o `NEXT_PUBLIC_WHATSAPP_PHONE` o fallback **hardcode** `573193455555`
- Inbound: extrae código → `referral_pending` (first-write-wins) → al crear pasajero atribuye `referred_by_driver_id` + `referral_attributions`
- Eventos: `link_opened`, `link_shared`, `passenger_registered`, `invalid_code`, `conversion` (primer trip `COMPLETED`)
- `/r/[code]`: landing **legacy**; registra `link_opened` y redirige a wa.me. No usar para compartir nuevos
- Menú conductor: compartir / copiar / resumen (`D_REF_*`)

**No hay** recompensa monetaria ni payout.

Ops: `/ops/referrals` (stats + leaderboard, lectura).

---

## 14. Modo mantenimiento

Tabla `bot_operational_status`, **una fila `id=1`**. Estados: `ACTIVE | MAINTENANCE`. **Global**, no por ciudad.

- Lectura fail-open: error → se trata como `ACTIVE`
- Cache 3 s; el gate conversacional bypasea cache
- Bypass: `BOT_MAINTENANCE_BYPASS_PHONES` (E.164, coma). Ops web nunca se bloquea
- Mensaje: CMS publicado `SYS_BOT_MAINTENANCE` si difiere del catálogo → si no, `maintenance_message` de Ops → si no, catálogo
- Ops `/ops/sistema` escribe el toggle y best-effort sync a `bot_messages`

---

## 15. CMS del Bot

`src/lib/bot-cms/{catalog,copy,resolve}.ts`

Runtime `cms(code)`:

1. `bot_messages` donde `status=PUBLISHED` y `is_active=true` (cache 30 s)
2. Si falta: log `[bot-cms:unpublished-or-missing]` + fallback `BOT_CMS_CATALOG` (copy en código)

Variables: `{{nombre}}` estilo `{{key}}`.

Este repo **no crea** el esquema CMS. Migraciones 043/044 solo hacen seed best-effort **si** `bot_messages` ya existe (esperado de Labs / otro proyecto).

Tablas leídas, no migradas aquí: `bot_messages`, `bot_conversation_trees`, `bot_conversation_nodes`, `bot_conversation_edges`.

El resolver de **árboles** existe en `resolve.ts` y **no tiene callers** en el handler. La conversación real está hardcodeada en `handler.ts` / `booking/flow.ts` / menús. Labs no gobierna el flujo; como mucho pisa textos PUBLISHED.

Excepción: confirmación Pasto **no** pasa por CMS; está en `buildPastoConfirmBody`.

---

## 16. Crons

Auth de todos: `Authorization: Bearer ${CRON_SECRET}`.

| Ruta | Qué hace | `vercel.json` |
|---|---|---|
| `GET /api/cron/documents` | Recordatorios/bloqueo docs + `closeExpiredTunnels` | `0 13 * * *` |
| `GET /api/cron/tunnels` | Cierra túneles con `closes_at` vencido | `5 13 * * *` |
| `GET /api/cron/launch-programs` | Cierra programas vencidos + drena cola WA | `* * * * *` |
| `GET /api/cron/search` | WaitingFlow timeouts | **No registrado** |

WaitingFlow adicionalmente corre en cada POST webhook.

Otra ruta API (no cron): `POST /api/telemetry/owntracks` — ingesta GPS OwnTracks → `driver_telemetry_devices` + `driver_location_points`. Independiente de booking. `trip_id` reservado, no usado en el flujo comercial.

---

## 17. Tablas de Supabase fundamentales

Creadas por migraciones de **este** repo:

| Tabla | Rol |
|---|---|
| `cities` | Ciudades habilitadas (centro + radio) |
| `drivers` | Conductores, `city_id`, disponibilidad, docs, password, referral_code |
| `passengers` | Pasajeros, status, referidos, no_show |
| `trips` | Viaje; `city_id` operacional; geo; `quoted_fare` nullable |
| `conversation_sessions` | Estado WhatsApp + booking draft |
| `conversation_tunnels` / `tunnel_messages` | Relé durante el servicio |
| `fare_rules` | Tarifas por ciudad (SSoT) |
| `holidays` | Festivos (CO) |
| `trip_driver_exclusions` | Republish sin el conductor que canceló |
| `trip_cancellations` | Causales |
| `document_reminders` | Recordatorios docs |
| `driver_auth_sessions` | Sesión auth WhatsApp del conductor |
| `route_favorites` | Máx. 2 recorridos / pasajero (sin `city_id`) |
| `passenger_ratings` | Reputación |
| `driver_profile_audits` / `driver_phone_change_requests` | Auditoría / cambio de número |
| `referral_attributions` / `referral_events` / `referral_pending` | Referidos |
| `launch_programs` + activation/outbound/city_launches | Pioneros |
| `bot_operational_status` | Mantenimiento global |
| `taximeter_test_sessions` / `taximeter_test_runs` | Calibración (no Mobility) |
| `driver_telemetry_devices` / `driver_location_points` | OwnTracks |

**Externas (consumo, no schema aquí):** `bot_messages`, `bot_conversation_*`.

---

## 18. Qué pertenece al Bot y qué al Panel

### Bot (este repo — producto WhatsApp)

`src/lib/whatsapp/**`, `booking/**`, `dispatch.ts`, `trips.ts`, `sessions.ts`, `search.ts`, `waiting-flow.ts`, `tunnels.ts`, `cancellations.ts`, `tariff/**`, `pricing/**` (legacy), `geo/**`, `city/**`, `driver-*`, `passenger-*`, `route-favorites/**`, `reputation/**`, `taximeter-test/**`, `voice/**`, `telemetry/**`, `api/webhook`, `api/cron/**`, `api/telemetry/**`.

### Ops embebido (este repo — no es el Panel de producto)

`src/app/ops/**`, `src/app/login/**`, `src/app/forgot-password/**`, `src/app/auth/**`, `src/middleware.ts` (solo refresca cookies Auth; **no** protege webhook).

Páginas reales:

- `/ops` → redirect `/ops/users`
- `/ops/users` — listar/filtrar pasajeros, cambiar status, desactivar Pioneros
- `/ops/referrals` — stats
- `/ops/marketing/programas/pioneros` — runtime + última auditoría city-launch
- `/ops/sistema` — ACTIVE/MAINTENANCE

Auth: usuario Supabase Auth. Layout redirige a `/login` si no hay sesión.

### Shared libs (Bot + Ops)

`bot-cms/**`, `bot-operational-status/**`, `launch-programs/**`, `referrals/**`, `supabase/**`, `city/context.ts`.

### WhatXia Operations Panel (producto)

**No está en este repositorio.** Cualquier CRUD de ciudades, tarifas, flota, mantenimiento por ciudad o CMS editor vive (o vivirá) fuera.

### WhatXia Labs

**No está en este repositorio.** El Bot lee `bot_messages` si existen.

### Taxímetro de prueba

Código Bot, no Labs. Independiente de `trips`. Activación pensada como `🚖` **solo** si ya hay sesión taxímetro o botón: el handler **no** entra al taxímetro en el primer `🚖` porque `isDriverIntent` lo manda al módulo conductor, y el gate del taxímetro exige sesión previa. Queda **código presente con activación probablemente inalcanzable** en el routing actual.

---

## 19. Dependencias actuales del Bot respecto del Operations Panel

El Bot **no llama** a un servicio Panel. Acoplamiento = **misma base Supabase** + tablas que Ops (embebido o futuro Panel) escribe:

| Recurso | El Bot hace |
|---|---|
| `bot_operational_status` | Lee (gate mantenimiento) |
| `launch_programs` + colas | Lee vigencia Pioneros; cron cierra y drena WhatsApp |
| `passengers.status` | Enforce acceso; Ops puede cambiarlo |
| `bot_messages` | Lee PUBLISHED (si Labs/Panel las publica) |
| `drivers.city_id` | Usa en dispatch; el Bot solo lo setea al **registrar** por hint |

El Bot no depende de que `/ops` esté desplegado. Si las filas no existen: Pioneros → nuevos = ACTIVE; mantenimiento → fail-open ACTIVE; CMS → catálogo.

---

## 20. Dependencias actuales del Panel respecto del Bot

El Ops **embebido** sí importa libs del Bot:

- `closeLaunchProgram` / runtime Pioneros
- `updateBotOperationalStatus`
- helpers de referidos y listado de pasajeros
- writes con `getSupabase()` (service role)

El Panel de producto (repo aparte) **no aparece** en este código. No hay API REST de movilidad para un Panel externo más allá de crons/webhook/telemetry.

Landing `/r/[code]` es un resto web del Bot (referidos), no Panel.

---

## Matriz por dominio

Leyenda: **FUNCIONAL** = camino de producción usable · **PARCIAL** = existe pero incompleto o acotado · **LEGACY** = código vivo que ya no debe gobernar · **PENDIENTE** = no implementado · **RIESGO** = puede romper operación

| Dominio | Estado | Notas |
|---|---|---|
| Webhook WhatsApp | FUNCIONAL | 200 siempre; firma HMAC |
| Booking Ibagué | FUNCIONAL | Destino + tarifa + Solicitar |
| Booking Pasto | PARCIAL | Publica sin tarifa; confirm inline |
| Dispatch por `city_id` | FUNCIONAL | Fail-closed sin city |
| Ciclo de viaje Ibagué | FUNCIONAL | ETA auto + túnel + finalizar |
| Ciclo de viaje Pasto | RIESGO | Terminar llama `finalizeFare` → error; trip no COMPLETED |
| WaitingFlow | FUNCIONAL | Lazy en webhook; cron search no en Vercel |
| Túneles | FUNCIONAL | Cierre 5 min |
| Cancelaciones | FUNCIONAL | Conductor republish; suspensión 8 h |
| Tarifas Ibagué | FUNCIONAL | `fare_rules` |
| Tarifas Pasto | PENDIENTE | Sin fila; no usar ceros |
| Tariff seeds / registry | LEGACY | No runtime |
| `pricing/*` + `getActiveFareRules` | LEGACY | Rompe con N ciudades |
| Places / Routes | FUNCIONAL | Bias por fila `cities` |
| `GEO_CITY_*` | LEGACY | Sin callers |
| `getActiveCity()` | LEGACY | Aún usado en city-launch |
| Multiciudad aislamiento | FUNCIONAL | Tests 1–8 |
| Tercera ciudad “solo dato” | PARCIAL | Impide: skip Pasto, launch legacy, CMS Ibagué, mantenimiento global |
| Registro conductor + `city_id` | FUNCIONAL | Hint de nombre |
| Auth conductor | FUNCIONAL | Password; document-login legacy |
| Documentos | FUNCIONAL | Cron diario |
| Pioneros | FUNCIONAL | Global, no por ciudad |
| City-launch Pioneros | PARCIAL / RIESGO | Atribuye a `getActiveCity()` = primer slug |
| Referidos | FUNCIONAL | Tracking; sin payout |
| `/r/[code]` | LEGACY | Compat |
| Mantenimiento | FUNCIONAL | Global |
| CMS textos | PARCIAL | Fallback catálogo; árboles no usados |
| Favoritos | PARCIAL | Máx. 2; sin `city_id` |
| Reputación / ratings | FUNCIONAL | |
| Ops `/ops` | PARCIAL | 4 pantallas; no Panel producto |
| Labs | PENDIENTE | Fuera del repo |
| Taxímetro prueba | LEGACY / RIESGO | Código sí; trigger 🚖 colisiona con driver intent |
| OwnTracks | PARCIAL | Ingesta; no alimenta dispatch |
| Voz Whisper | FUNCIONAL | Capa WhatsApp; Mobility ve texto |
| Panel CRUD ciudades/tarifas | PENDIENTE | Fuera de alcance Bot |

---

## Inventario de hardcodes y ataduras de ciudad

### Hardcodes por ciudad (runtime)

| Ubicación | Qué hace |
|---|---|
| `src/lib/booking/flow.ts` → `PASTO_CITY_SLUG` | Única ciudad que publica sin `estimateFare` / sin quote |
| `buildPastoConfirmBody` | Copy Pasto fuera del CMS |
| `src/lib/referrals/codes.ts` → `WHATXIA_OFFICIAL_WHATSAPP_E164` | Fallback `573193455555` |
| `present-estimate.ts` | Margen UI +3000; texto “+$800 por solicitud” |

### Hardcodes de tarifas

| Ubicación | Qué hace |
|---|---|
| `ESTIMATED_FARE_RANGE_MARGIN_COP = 3000` | Solo presentación |
| `APPLY_CALL_SURCHARGE_ON_ESTIMATE = false` | Política de estimado |
| Copy “$800” | Presentación, no lee DB |
| `city-config/ibague.ts` | Seed deprecated (números reales de Ibagué) |
| `city-config/pasto.ts` / `medellin.ts` | Ceros; **no usar en producción** |

Runtime comercial Ibagué = **DB** `fare_rules`, no esos archivos.

### Dependencias específicas de Ibagué

- Migración 017: ciudad + backfill + Perales
- Migraciones 020–028: reglas oficiales
- Defaults `GEO_CITY_*` = Ibagué (legacy)
- CMS/catálogo y $800 / Perales
- Camino default de booking (todo lo que no es slug `pasto`)
- `getActiveCity()` con Ibagué+Pasto habilitadas devuelve **ibague** (orden slug)

### Dependencias específicas de Pasto

- Migración 046: insert ciudad, sin `fare_rules`
- `PASTO_CITY_SLUG` / `requiresFareQuote` / `buildPastoConfirmBody`
- Tests en `booking-flow.certify.ts`, `city.certify.ts`, `multicity.certify.ts`

### Variables de entorno relacionadas con ciudad

| Nombre | Uso real |
|---|---|
| `GEO_CITY_LAT` | Legacy, sin callers |
| `GEO_CITY_LNG` | Legacy, sin callers |
| `GEO_CITY_RADIUS_M` | Legacy, sin callers |
| `PLACE_CONFIDENCE_THRESHOLD` | Sí, scoring Places (no es ciudad) |
| `GOOGLE_MAPS_API_KEY` | Sí, geo |
| `PRE_LAUNCH_MODE` | Ignorada |

No hay `CITY_SLUG` / `ACTIVE_CITY` env. La ciudad operativa sale de `cities` + pickup.

### Lógica que impide abrir ciudades nuevas sin tocar código

1. Skip de cotización atado a slug `"pasto"` (no a “ciudad sin fare_rules”)
2. `finalizeFare` siempre se llama al terminar — una ciudad sin `fare_rules` no cierra viajes
3. `getActiveCity()` en lanzamiento Pioneros
4. Mantenimiento global
5. Favoritos sin `city_id`
6. Copy CMS con supuestos de Ibagué
7. Hint de registro: el conductor debe escribir un **nombre/slug que exista** en `cities`; no hay UI de asignación

Lo que **sí** es dato: radio, centro, enable, `fare_rules`, aislamiento dispatch.

---

## FRONTERA BOT vs OPERATIONS PANEL

```
                    WhatsApp Cloud API
                            │
                            ▼
                 POST /api/webhook  ──────────── WhatXia BOT
                 handler + booking + dispatch
                 trips + tunnels + tariff + CMS consume
                            │
                            │  misma base Supabase
                            ▼
                 /ops (auth web)  ────────────── Ops EMBEBIDO
                 usuarios, referidos, pioneros,
                 toggle mantenimiento
                            │
                            ✕ no está en este repo
                            ▼
                 WhatXia Operations Panel ────── producto aparte
                 (CRUD ciudades, tarifas, flota,
                  ops por ciudad — no existe aquí)

                 WhatXia Labs ────────────────── no está en este repo
                 (editor CMS / bot_messages schema)
```

**Dónde termina el Bot**

En el momento en que un hecho operacional ya está persistido (`trips`, `drivers`, `sessions`, mensajes WhatsApp enviados) y el pasajero/conductor ya no necesitan más turnos conversacionales para ese hecho.

El Bot **ejecuta** movilidad. No administra catálogo de ciudades ni edita tarifas (salvo leer `fare_rules`).

**Dónde comienza el Panel**

En cualquier operación de **configuración y gobierno** que un humano no-pasajero hace sobre el sistema: activar ciudad, cargar `fare_rules`, mover `drivers.city_id`, mantenimiento, cupos Pioneros, ver métricas.

Hoy ese gobierno está **parcialmente** en `/ops` (usuarios, pioneros, referidos, mantenimiento global) y **ausente** para ciudades/tarifas/flota.

Labs, si existe fuera, solo debería publicar copy (`bot_messages`). No orquesta viajes.

---

## ESTADO MULTICIUDAD

**¿Puede el Bot operar varias ciudades a la vez?** Sí, en aislamiento de viaje y dispatch.

| Capacidad | ¿Listo? |
|---|---|
| N filas `cities.active=true` | Sí (046) |
| Ciudad del viaje = pickup, no singleton | Sí (`trip.city_id`) |
| Conductores de Ibagué no ven viajes Pasto y viceversa | Sí |
| Accept cross-city rechazado | Sí |
| Republish conserva ciudad | Sí |
| Pickup fuera de cobertura no crea trip | Sí |
| Places/Routes por ciudad del pickup | Sí |
| Ibagué cotiza con `fare_rules` | Sí |
| Pasto publica sin tarifa | Sí (hardcode slug) |
| Pasto cierra tarifa al finalizar | **No** |
| Pioneros / mantenimiento / CMS / favoritos por ciudad | **No** |
| Tercera ciudad sin tocar código (con tarifas) | Casi: DB + drivers; vigilar launch/CMS |
| Tercera ciudad sin tarifas (como demo Pasto) | Requiere código (hoy solo `pasto`) |
| `GEO_CITY_*` / `getActiveCity` como SSoT | **No** — legacy |

**Resumen CTO:** el núcleo movilidad (pickup → trip → oferta → accept) es multi-ciudad. La excepción Pasto es **demo operacional de publicación**, no un modelo tarifario. Cerrar el viaje en Pasto sigue atado a `fare_rules`. Programas de lanzamiento y mantenimiento siguen pensando en un bot global, no en N ciudades.

---

## Variables de entorno (nombres; sin valores)

**Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`  
**WhatsApp:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_API_VERSION`, `WHATSAPP_BUSINESS_PHONE`, `NEXT_PUBLIC_WHATSAPP_PHONE`  
**Sitio / referidos:** `NEXT_PUBLIC_SITE_URL`, `REFERRAL_PUBLIC_BASE_URL`  
**Cron:** `CRON_SECRET`  
**Ops / bot:** `BOT_MAINTENANCE_BYPASS_PHONES` · `PRE_LAUNCH_MODE` (ignorada)  
**Geo:** `GOOGLE_MAPS_API_KEY`, `GEO_CITY_LAT`, `GEO_CITY_LNG`, `GEO_CITY_RADIUS_M`, `PLACE_CONFIDENCE_THRESHOLD`  
**Voz:** `VOICE_TRANSCRIPTION_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_WHISPER_MODEL`, `OPENAI_WHISPER_LANGUAGE`  
**OwnTracks:** `OWNTRACKS_HTTP_SECRET`, `OWNTRACKS_HTTP_USER`  
**Plataforma:** `PORT` (3002), `VERCEL`, `VERCEL_ENV`, `NODE_ENV`

---

## Cómo verificar este documento contra el código

```bash
npx tsx src/lib/booking-flow.certify.ts
npx tsx src/lib/city.certify.ts
npx tsx src/lib/multicity.certify.ts
npx tsx src/lib/tariff.certify.ts
npx tsc --noEmit
```

Si un hecho de este archivo no coincide con esos tests o con `src/lib/booking/flow.ts` / `dispatch.ts` / `trips.ts` / `city/context.ts`, gana el código.
