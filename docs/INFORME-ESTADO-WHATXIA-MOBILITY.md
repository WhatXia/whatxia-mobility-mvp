# Informe ejecutivo — Estado de WhatXia Mobility

**Fecha:** 23 de julio de 2026  
**Versión del producto:** `whatxia-mobility-mvp` 0.1.0  
**Alcance geográfico actual:** Ibagué (Colombia)  
**Canal principal:** WhatsApp Cloud API (Meta)  
**Stack:** Next.js 16 · React 19 · Supabase · Vercel  

---

## 1. Visión del proyecto

### ¿Cuál es el objetivo actual de WhatXia Mobility?

Construir un **MVP operable de movilidad urbana por WhatsApp** que permita a un pasajero solicitar un taxi, a un conductor aceptar y ejecutar el servicio, y a WhatXia **cotizar y cerrar la tarifa** con reglas oficiales de la ciudad — sin app nativa de pasajero ni conductor.

El producto se centra hoy en **Ibagué**, con la ambición de que el motor tarifario, el despacho y el canal conversacional sean reutilizables para otras ciudades vía configuración en base de datos (`cities`, `fare_rules`, `holidays`).

### ¿Qué problema resuelve?

| Problema | Cómo lo aborda WhatXia |
|----------|------------------------|
| Fricción de pedir un taxi por teléfono o apps pesadas | Solicitud conversacional en WhatsApp (texto, ubicación, voz→texto) |
| Asignación manual e informal de conductores | Despacho a conductores disponibles con aceptación, ETA y ciclo de viaje |
| Tarifas opacas o inconsistentes | Motor tarifario basado en `fare_rules` + festivos + ruta Google |
| Falta de canal pasajero–conductor durante el servicio | Túnel de conversación efímero en WhatsApp |
| Calibración del precio WhatXia vs realidad de calle | Modo Taxímetro de Prueba (independiente del viaje comercial) |

En una frase: **WhatXia Mobility quiere ser el “sistema operativo” de un servicio de taxi por WhatsApp**, con tarifa trazable y operación medible.

---

## 2. Estado funcional

### ¿Qué puede hacer hoy el sistema?

| Capacidad | Estado |
|-----------|--------|
| Recibir y verificar webhooks de WhatsApp | Operativo |
| Menú de pasajero y menú de conductor (mismo número) | Operativo |
| Solicitar servicio (intención en texto libre o menú) | Operativo |
| Captura de origen (pin WhatsApp / texto) y destino (Places + recuperación) | Operativo |
| Cotización previa y creación de viaje | Operativo |
| Oferta a conductores, aceptar/rechazar, ETA, llegada, iniciar, navegar, finalizar | Operativo |
| Reasignación / exclusión de conductores / búsqueda con timeout | Operativo |
| Cancelaciones con políticas (pasajero y conductor) | Operativo |
| Túnel de chat pasajero ↔ conductor | Operativo |
| Tarifa final al completar viaje (`finalizeFare`) | Operativo |
| Calificación post-viaje (pasajero) | Operativo |
| Registro y actualización de perfil/documentos del conductor + cron documental | Operativo |
| Notas de voz → Whisper → mismo flujo de texto | Operativo (requiere `OPENAI_API_KEY`) |
| Taxímetro de prueba (calibración, sin crear trips) | Operativo (MVP simplificado) |

### ¿Qué flujo funciona de punta a punta?

**Viaje comercial (Mobility):**

1. Pasajero escribe / usa menú / nota de voz → intención de viaje.  
2. Se resuelven origen y destino → cotización WhatXia.  
3. Se crea `trip` en `SEARCHING` → ofertas a conductores disponibles.  
4. Conductor acepta → ETA → llega → inicia → navega → finaliza.  
5. Se calcula `final_fare` → se notifica → túnel se cierra → pasajero califica.

Ese es el **camino crítico productivo** del MVP.

### ¿Qué aún no funciona (o está incompleto)?

| Ítem | Detalle |
|------|---------|
| Documentación de producto | README aún es boilerplate de Next.js; no hay narrativa oficial en repo |
| UI web de producto | Landing de Next starter; el producto real es el bot |
| Multi-ciudad en runtime | Modelo de datos listo; operación activa = Ibagué |
| Analytics / rendimiento del conductor | Menú con stubs (“Pronto podrás…”) |
| Reportes del conductor | Stub |
| Comparación taxímetro físico vs WhatXia | Removida del MVP simplificado (`meter_value` opcional/null) |
| Pickup solo por Places (sin pin) | Marcado como futuro; MVP prioriza pin WhatsApp |
| Cron Vercel de search timeouts | Existe ruta API; el timeout también corre al recibir webhooks (`processDueSearchTimeouts`) |

---

## 3. Módulos implementados

| Módulo | Propósito | Estado | Dependencias |
|--------|-----------|--------|--------------|
| **WhatsApp ingress** (`whatsapp/*`, `/api/webhook`) | Verificar firma, parsear mensajes, normalizar audio→texto, enrutar | Terminado | Meta Cloud API, OpenAI (voz) |
| **Booking / Mobility** (`booking/*`) | Intención, slots origen/destino, Places, cotización, crear viaje | Terminado (iterativo) | Geo, Tariff, Sessions, Trips |
| **Dispatch** (`dispatch.ts`) | Ofertas, aceptación, ETA, llegada, inicio, fin, navegación | Terminado | Trips, Drivers, WhatsApp, Geo, Tariff |
| **Waiting / search** | Timeouts de búsqueda, continuar/cancelar, `cancelled_no_driver` | Terminado | Trips, WhatsApp |
| **Tunnels** | Canal P↔D durante el servicio + cierre programado | Terminado | Supabase tunnels, cron |
| **Cancellations** | Cancelación pasajero/conductor, causales, políticas, exclusiones | Terminado | Trips, exclusions |
| **Tariff Engine v1** (`tariff/*`) | Estimar y finalizar tarifas COP desde `fare_rules` + `holidays` | Terminado (calibración en curso) | Supabase, Routes, city context |
| **Geo** (`geo/*`) | Places, Geocoding, Routes, bias de ciudad | Terminado | Google Maps Platform |
| **Drivers** | Registro, perfil, disponibilidad, documentos, bloqueos | Terminado | Supabase, cron documentos |
| **Passengers** | Alta automática al solicitar | Terminado | Supabase |
| **Sessions** | Estado conversacional + `booking_draft` | Terminado | Supabase |
| **Rating** | Calificación post-viaje | Terminado | Trips, WhatsApp |
| **Voice** | Transcripción Whisper en frontera WhatsApp | Terminado | OpenAI |
| **Taximeter test** | Calibración de tarifa en campo, sin trips | Terminado (MVP simplificado) | Tariff, Routes, Supabase |
| **City context** | Ciudad activa (Ibagué) | Terminado | `cities` |
| **Pricing legacy** (`pricing/*`) | Motor anterior | Deprecado | — |
| **Driver performance / report** | Menú conductor | Pendiente (stub) | — |
| **Panel admin / web ops** | Operación y BI | Pendiente | — |

---

## 4. Flujo conversacional completo

```
WhatsApp usuario
    → Meta Cloud API webhook
    → /api/webhook (firma + parse)
    → normalize (si audio: Whisper → text)
    → handleIncomingMessage
```

**Orden de prioridad del handler (simplificado):**

1. Calificación post-viaje  
2. Cancelaciones / “Ya voy”  
3. Timeouts de búsqueda pendientes  
4. Botones de despacho del conductor (aceptar, ETA, llegar, iniciar, navegar, finalizar)  
5. Menú del conductor (disponibilidad, datos, docs…)  
6. **Taxímetro de prueba** (si `🚖`, botón taxímetro o sesión activa)  
7. Booking Mobility (menú / intención / sesión de reserva)  
8. Túnel de conversación (si hay túnel abierto)  
9. Registro/actualización de conductor o docs vencidos  
10. Saludo → menú pasajero o menú conductor  
11. Fallback de ayuda  

**Camino típico del pasajero hoy**

`Hola` → menú → solicitar / texto con intención → origen (pin o texto) → destino → cotización → confirmación → búsqueda de conductor → asignación → seguimiento por mensajes + túnel → fin → calificación.

**Camino típico del conductor hoy**

`Hola` → menú conductor → disponible → recibe oferta → aceptar → ETA → ver ubicación / llegar → iniciar → navegar / terminar → (opcional) taxímetro `🚖` en paralelo, fuera de trips.

---

## 5. Motor tarifario

### Estado actual

- **SSoT:** tabla `fare_rules` (por ciudad, fila activa) + tabla `holidays` (calendario CO).  
- **API pública:** `estimateFare` / `finalizeFare` / `resolveCityTariff` en `@/lib/tariff`.  
- **Versión etiquetada en calibración:** `pricing_engine_version = v1`.  
- Parámetros oficiales de Ibagué alineados en migraciones (banderazo, incrementos ~80 m, nocturno 19:00–06:00, recargos).

### Cómo calcula la tarifa

1. **Distancia y tiempo de ruta** (Google Routes; fallback haversine en taxímetro).  
2. **Tarifa oficial base:** banderazo + incrementos por distancia + incrementos por tiempo + espera (si aplica).  
3. **Piso:** `max(tarifa_calculada, tarifa_mínima)`.  
4. **Recargos (configurados en `fare_rules`):**  
   - Nocturno (ventana de horas de la ciudad)  
   - Domingo **o** festivo nacional (`holidays`) — una sola vez  
   - Aeropuerto (keywords / geo)  
   - Plataforma WhatXia (`surcharge_whatxia`) según contexto  
5. **Finalización de viaje:** usa `started_at` / `finished_at`, puede derivar espera por velocidad, persiste `final_fare` en `trips`.

### Qué falta para considerarlo “listo”

| Pendiente | Por qué importa |
|-----------|-----------------|
| Muestra estadística de corridas reales (taxímetro de prueba) | Validar sesgo WhatXia vs calle/satelital |
| Volver a capturar valor del taxímetro físico (opcional) | Diferencia en pesos y % para ajuste fino |
| Monitoreo de outliers (rutas fallidas → haversine) | Calidad de la distancia |
| Reglas por ciudad adicional sin redeploy | Expansión |
| Auditoría operativa (panel o export) | Confianza de negocio y regulatoria |

El motor **está implementado y enchufado al viaje**; lo que falta es **calibración empírica y gobernanza**, no la fórmula base.

---

## 6. Modo Taxímetro de Prueba

### Para qué se construyó

Para **calibrar el motor tarifario con recorridos reales** sin contaminar Mobility: no crea `trips`, no despacha, no habla con pasajeros.

### Cómo funciona hoy (MVP simplificado)

| Paso | Acción |
|------|--------|
| 1 | Conductor envía `🚖` |
| 2 | Sistema pide ubicación inicial (location request) |
| 3 | Pin inicial → guarda punto + hora → pide ubicación final |
| 4 | Pin final → “¿Confirmas que el recorrido ha terminado?” + botón `✅ Terminar recorrido` |
| 5 | Calcula distancia/tiempo (Google Routes), tarifa WhatXia → Calle / Satelital |
| 6 | Guarda corrida y cierra sesión |

Fuente de verdad del flujo: `session.state`  
(`awaiting_start_location` → `awaiting_end_location` → `awaiting_confirm_finish` → `awaiting_service_type`).

### Qué información registra (`taximeter_test_runs`)

- Conductor (id, teléfono, nombre)  
- Inicio / fin (timestamp + lat/lng)  
- Distancia y duración  
- Tarifa WhatXia  
- Tipo de servicio (`calle` / `satelital`) y recargo de pickup  
- Provider de ruta, polyline, snapshot JSON `route`  
- `pricing_engine_version`  
- `city_slug`  
- `meter_value` / diferencias: **null en este MVP** (migración 027)

Sesión efímera: `taximeter_test_sessions` (PK por teléfono).

---

## 7. Base de datos

### Tablas principales

| Dominio | Tablas |
|---------|--------|
| Actores | `drivers`, `passengers` |
| Viajes | `trips`, `trip_cancellations`, `trip_driver_exclusions` |
| Conversación | `conversation_sessions`, `conversation_tunnels`, `tunnel_messages` |
| Documentos | campos en `drivers` + `document_reminders` |
| Ciudad / tarifa | `cities`, `fare_rules`, `holidays` |
| Calibración | `taximeter_test_sessions`, `taximeter_test_runs` |

### Estado de las migraciones

Existen **027 migraciones** secuenciales (`001` … `027`).  
Grupos:

1. **001–003** — drivers, trips, passengers  
2. **004–006** — perfil conductor, sessions, documentos  
3. **007–008** — tunnels  
4. **009–012, 018** — cancelaciones, search, exclusiones, waiting  
5. **013–014, 019** — booking draft, geo/fare en trip, final_fare  
6. **015–017, 020–024** — fare_rules, city context, tarifas oficiales Ibagué, holidays  
7. **025–027** — taxímetro de prueba + meter opcional  

**Importante ops:** el entorno de producción debe tener aplicadas **todas** hasta `027` para que el taxímetro MVP y el motor con festivos funcionen sin errores de esquema.

### Relaciones importantes

- `trips.driver_id` → `drivers`  
- `trips.passenger_id` → `passengers`  
- `fare_rules.city_id` → `cities`  
- `drivers.city_id` → `cities`  
- Túnel ligado al viaje / teléfonos P↔D  
- Taxímetro: `taximeter_test_runs.driver_id` → `drivers` (sin FK a `trips` a propósito)

---

## 8. APIs e integraciones

| Integración | Uso | Notas |
|-------------|-----|--------|
| **Meta WhatsApp Cloud API** | Mensajes texto, botones, location request/pin, media de audio | `v21.0` por defecto; firma HMAC del webhook |
| **Google Places API (New)** | Resolución de destinos / lugares | Bias a ciudad activa |
| **Google Geocoding** | Reverse/forward cuando aplica | Servidor only |
| **Google Routes API** | Distancia, duración, polyline | Fallback haversine en taxímetro |
| **Supabase** | Persistencia, service role en servidor | Fuente de verdad de dominio |
| **OpenAI Whisper** | Notas de voz → texto | Solo frontera WhatsApp |
| **Vercel** | Hosting + crons documentos/túneles | Search timeout dual (cron API + webhook) |

Variables clave: ver `.env.example` (`WHATSAPP_*`, `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`, Supabase, `CRON_SECRET`).

---

## 9. Roadmap (sprints en orden cronológico)

Basado en el historial de commits del repositorio:

| # | Sprint / hito | Objetivo | Resultado | Estado |
|---|---------------|----------|-----------|--------|
| 0 | Bootstrap Next + Mobility inicial | Base del bot | App Next + handler WhatsApp | Hecho |
| 1–7 | Fases tempranas MVP | Conversación + Supabase | Conexión datos y flujo básico | Hecho |
| MVP 1.0 | Ciclo de viaje | Asignación → ETA → llegada → inicio → fin → rating | Viaje E2E | Hecho |
| 13 | Persistencia de viajes | Trips en Supabase | Persistencia real | Hecho |
| 14 | Pasajeros | Alta automática | Tabla `passengers` | Hecho |
| 15 | Menú conductor | Dual rol + disponibilidad | Menú dinámico | Hecho |
| 16 | Registro conductor | Onboarding / update | Perfil completo | Hecho |
| 17 | Documentos | Vencimientos + cron | Bloqueo / recordatorios | Hecho |
| 18 | Conversation Tunnel | Chat P↔D | Túneles + cierre | Hecho |
| 20 | Cancelaciones | Políticas operativas | Causales + reglas | Hecho |
| 21 | Reasignación | Búsqueda inteligente | Exclusiones + redisparo | Hecho |
| 23–24 | Geo + booking | Origen/destino, Places, cotización | Motor geográfico + reserva | Hecho |
| 25 | Fare rules | Tarifas configurables | Pricing → Tariff path | Hecho |
| 26 | City context | Restringir a Ibagué | `cities` + bias | Hecho |
| 27 | Waiting flow | Sin conductor | Timeout / continuar | Hecho |
| 28–29 | Places UX | Bias Ibagué + recuperación destino | Mejor match destino | Hecho |
| MVP UX conductor | Inicio de viaje claro | Destino + navegar + terminar | UX simplificada | Hecho |
| Tariff SSoT | `fare_rules` única fuente | Sin fallback de archivo | Hecho |
| Nocturno Ibagué | 19:00–06:00 | Ventana oficial | Hecho |
| Holidays | Festivos CO en Supabase | Recargo domingo/festivo | Hecho |
| Intent Mobility | Texto libre sin “Hola” obligatorio | Pickup/destino inferidos | Hecho |
| Voice | Whisper E2E en WhatsApp | Audio → mismo flujo | Hecho |
| Taxímetro | Calibración en campo | Pipeline + MVP simplificado | Hecho |

---

## 10. Próximo objetivo (siguiente sprint lógico)

**Sprint recomendado: “Calibración tarifaria en campo + lectura operativa”**

Objetivo: usar el Taxímetro de Prueba ya desplegable para **recolectar N corridas reales en Ibagué**, analizar sesgo WhatXia vs tipo Calle/Satelital, y decidir el primer ajuste de parámetros en `fare_rules` (o reintroducir captura del valor del taxímetro físico si el negocio lo exige).

**Entregables sugeridos:**

1. Checklist ops: migraciones ≤027 aplicadas, keys Google/OpenAI/WhatsApp OK.  
2. Protocolo de prueba para conductores piloto (10–30 corridas).  
3. Export/consulta simple de `taximeter_test_runs` (SQL view o sheet).  
4. Decisión de negocio: ¿ajustar banderazo/incrementos o reactivar `meter_value`?  
5. (Opcional en paralelo) Quitar stubs de rendimiento/reporte o dejarlos fuera del menú.

**Por qué este sprint y no otro:** el loop comercial E2E ya existe; el riesgo principal de negocio es **confianza en la tarifa**. El taxímetro fue creado exactamente para desbloquear eso.

---

## 11. Estado general — resumen para CTO

WhatXia Mobility es hoy un **MVP de taxi por WhatsApp, enfocado en Ibagué**, con backend en Next.js sobre Vercel y dominio en Supabase. El producto no es una app móvil: es un **bot operacional** que ya cubre el ciclo completo de un viaje (solicitud → despacho → ejecución → tarifa → calificación), más operación de conductores (disponibilidad, documentos, cancelaciones, túnel de chat) y una capa de voz.

El **motor tarifario v1 está implementado y es la fuente de verdad en base de datos** (`fare_rules` + `holidays`), integrado tanto al viaje comercial como al modo de calibración. Lo que aún no está “cerrado de negocio” no es la ingeniería del cálculo, sino la **validación empírica en calle**.

El **Taxímetro de Prueba** es el instrumento correcto para esa validación: independiente de Mobility, listo en flujo mínimo (pins inicio/fin → confirmar → Calle/Satelital → registro). Debe usarse ya para generar datos; no para seguir rediseñando el happy path del bot.

**Madurez global estimada:** ~70–80% para un piloto controlado en una ciudad; ~40% para expansión multi-ciudad y operación con panel.  
**Riesgos principales:** calidad de geocoding/Places en destinos ambiguos; dependencia de webhooks WhatsApp; calibración tarifaria aún sin muestra estadística; documentación de producto ausente en el repo.  
**Fortalezas:** arquitectura conversacional clara, separación Mobility vs taxímetro, esquema migrado hasta 027, stack simple (un solo deploy).

**Veredicto:** WhatXia Mobility está en fase de **piloto de producción en Ibagué**, no de prototipo de idea. El siguiente movimiento de mayor ROI no es otra feature de chat: es **medir y ajustar la tarifa con datos reales del taxímetro de prueba**, y solo después ampliar superficie (panel, multi-ciudad, analytics de conductor).

---

*Documento generado a partir del análisis del repositorio (código, migraciones 001–027, historial de commits e integraciones configuradas). No sustituye métricas de producción (volúmenes, errores Vercel/Supabase) que deben leerse en los dashboards del entorno desplegado.*
