# Sprint 01 — Prioridad crítica

**Producto:** WhatXia Mobility MVP  
**Canal:** WhatsApp Cloud API  
**Ciudad piloto:** Ibagué (Colombia)  
**Documento:** plan de implementación (historias, tareas y criterios de aceptación)  
**Uso:** referencia para implementación y verificación de este sprint. No sustituye el backup técnico en `docs/backup/`.

---

## 1. Visión del producto

WhatXia Mobility transforma WhatsApp en una experiencia de movilidad simple, rápida y segura. Solicita tu servicio directamente por WhatsApp, sin descargar aplicaciones ni crear cuentas. Conectamos usuarios y conductores mediante tecnología conversacional que facilita cada viaje, desde la solicitud hasta la asignación del móvil. Nuestra misión es hacer la movilidad más accesible, cercana y eficiente, utilizando la plataforma que las personas ya usan todos los días. 🚕💬🤖

---

## 2. Objetivo del sprint

Cerrar el **camino crítico conversacional** del MVP: solicitud → cotización → despacho → viaje → calificación bidireccional → retorno inmediato a menús de acción, con favoritos de recorridos y reputación visible, **sin obligar a escribir “Hola”** para continuar.

Al finalizar este sprint, pasajero y conductor deben poder operar el ciclo completo en WhatsApp con opciones siempre disponibles al terminar o cancelar un flujo.

---

## 3. Alcance

### Incluye

| Área | Resumen |
|------|---------|
| Favoritos de recorridos | Persistencia, activación inmediata, saludo inteligente, uso directo → cotización |
| Menús de acción continuos | Tras cancelar o finalizar (pasajero); menú principal tras calificar (conductor) |
| Reputación bidireccional | Conductor califica pasajero; promedios reales; visibilidad en oferta y aceptación |
| Despacho operable | Publicación de ofertas a conductores disponibles; migraciones requeridas aplicadas |
| Auth / menú conductor | Sesión iniciada; disponibilidad; Mi cuenta; Cerrar sesión (sin inventar menús nuevos) |

### Fuera de alcance (sprints posteriores)

- Panel admin / BI  
- Multi-ciudad en runtime (ops = Ibagué)  
- Términos y Condiciones en registro  
- RLS / Auth Supabase de extremo a extremo  
- Landing / README de producto (no modificar en este sprint)  
- Reemplazo de favoritos cuando ya hay 2  

---

## 4. Dependencias técnicas

Aplicar en Supabase (orden):

| Migración | Propósito |
|-----------|-----------|
| `030` | `document_id` único en conductores |
| `031` | `password_hash` |
| `032` | `driver_auth_sessions` |
| `033` | `route_favorites` |
| `034` | `passenger_ratings` |

**Crítico:** sin `034`, la consulta de reputación del pasajero en `publishTripOffer` puede interrumpir el envío de ofertas a conductores. Verificar siempre tras desplegar.

Módulos de referencia:

| Concepto | Código |
|----------|--------|
| Core Agent | `src/lib/whatsapp/handler.ts` |
| Booking / Pricing | `src/lib/booking/flow.ts`, `src/lib/tariff/` |
| Dispatch | `src/lib/dispatch.ts` |
| Favoritos | `src/lib/route-favorites/` |
| Reputación | `src/lib/reputation/` |
| Rating pasajero→viaje | `src/lib/rating.ts` |
| Menú conductor | `src/lib/driver-menu.ts` → `sendDriverMainMenu` |
| Menú acción pasajero | `sendPassengerActionMenu` / `buildFavoritesGreeting` |

---

## 5. Historias de usuario

### HU-01 — Favoritos: guardar recorrido post-viaje

**Como** pasajero,  
**quiero** guardar un recorrido (origen + destino) como favorito después de calificar,  
**para** solicitarlo después con un toque.

#### Tareas

- [ ] Tabla `route_favorites` (migración `033`) con origen y destino completos.  
- [ ] Límite de **2** favoritos por pasajero (enforce en app).  
- [ ] Oferta post-calificación si hay &lt; 2 favoritos y el viaje tiene geo completa.  
- [ ] Nombre: Casa / Oficina / Otro (texto libre).  
- [ ] Confirmación de guardado con copy de producto.

#### Criterios de aceptación

1. Tras calificar un viaje con geo completa y &lt; 2 favoritos, se pregunta si desea guardar el recorrido.  
2. Si ya tiene 2 favoritos, **no** se ofrece guardar; se agradece y se muestran botones de acción.  
3. Al guardar, el favorito queda en BD con `pickup_*` y `dropoff_*` reales del viaje.  
4. Tras el mensaje “✅ ¡Listo!…”, se muestran de inmediato los botones de acción (sin pedir “Hola”).

---

### HU-02 — Favoritos: saludo inteligente y uso directo

**Como** pasajero,  
**quiero** ver mis favoritos al saludar y usarlos para cotizar sin repetir origen/destino,  
**para** pedir el mismo recorrido más rápido.

#### Tareas

- [ ] Saludos: Hola / Buenos días / Buenas tardes / Buenas noches → consultar `route_favorites`.  
- [ ] Reutilizar `buildFavoritesGreeting` + `listRouteFavorites` / `sendPassengerActionMenu`.  
- [ ] 1 favorito → Favorito · Solicitar servicio · Cancelar.  
- [ ] 2 favoritos → Favorito 1 · Favorito 2 · Solicitar servicio.  
- [ ] Sin favoritos → menú genérico Solicitar · Cancelar.  
- [ ] Pulsar favorito → `startBookingFromFavorite` → cotización → confirmación → despacho (sin pedir ubicación/destino).

#### Criterios de aceptación

1. Con favoritos, el saludo **no** muestra “¿Qué deseas hacer?” genérico; muestra “¿A dónde vamos hoy?” + botones dinámicos.  
2. Al usar un favorito se muestra el resumen de cotización con origen/destino del favorito.  
3. Confirmar “Solicitar” publica el servicio a conductores elegibles.  
4. No se pide pin de origen ni texto de destino si el favorito es válido y dentro de la ciudad.

---

### HU-03 — Menú de acción continuo (pasajero)

**Como** pasajero,  
**quiero** botones de acción siempre que termine o cancele una solicitud,  
**para** pedir otro servicio sin escribir “Hola”.

#### Tareas

- [ ] Función única `sendPassengerActionMenu` (reutilizable).  
- [ ] Cablear tras: cancelar viaje, cancelar cotización, cancelar búsqueda, sin conductor, cancelar sin viaje activo.  
- [ ] Cablear tras: fin de flujo de calificación / favoritos (o rechazo de guardar favorito).  
- [ ] Botones dinámicos según cantidad de favoritos (misma regla que HU-02).

#### Criterios de aceptación

1. Tras cualquier cancelación de solicitud/viaje del pasajero, aparecen botones de acción.  
2. Tras completar calificación (+ favorito si aplica), aparecen botones de acción.  
3. Sin favoritos: Solicitar servicio · Cancelar.  
4. La conversación no queda “muerta” sin opciones al cerrar un flujo.

---

### HU-04 — Reputación: conductor califica al pasajero

**Como** conductor,  
**quiero** calificar al pasajero al finalizar el viaje,  
**para** construir reputación usable en futuras ofertas.

#### Tareas

- [ ] Tabla `passenger_ratings` (migración `034`): `trip_id`, `driver_id`, `passenger_id`, `rating`, `created_at`.  
- [ ] Una calificación por viaje (unique `trip_id`).  
- [ ] Prompt al finalizar: “¿Cómo fue tu experiencia con este pasajero?” (Excelente / Buena / Regular).  
- [ ] Servicio reutilizable de promedio (`src/lib/reputation/`) para conductor y pasajero.  
- [ ] Tras guardar + mensaje de gracias → `sendDriverMainMenu` (disponibilidad real).

#### Criterios de aceptación

1. Al marcar Finalizado, el conductor recibe el prompt de calificación del pasajero.  
2. La calificación se persiste en `passenger_ratings` con datos reales.  
3. Promedio del pasajero a **1 decimal** (ej. `4.8 / 5.0`); sin historial → “Usuario nuevo” / “Pasajero nuevo” según contexto.  
4. Tras calificar, se muestra el **menú principal existente** del conductor (Disponible/No disponible · Mi cuenta · Cerrar sesión), sin menú nuevo.  
5. El botón de disponibilidad refleja el estado actual (`is_available`).

---

### HU-05 — Reputación visible en despacho y asignación

**Como** conductor/pasajero,  
**quiero** ver la reputación de la otra parte en momentos clave,  
**para** decidir con más confianza.

#### Tareas

- [ ] Oferta a conductores: origen, destino, tarifa estimada, línea de calificación del pasajero.  
- [ ] Mensaje al pasajero al aceptar: nombre, vehículo (`Taxi {placa}`), calificación del conductor.  
- [ ] Promedios solo con datos reales de BD (sin simulaciones).  
- [ ] Conductor: promedio desde `trips.rating`; pasajero: desde `passenger_ratings`.  
- [ ] Reutilizar servicio de reputación (no duplicar lógica de promedio).

#### Criterios de aceptación

1. Oferta incluye `⭐ Pasajero: X.X / 5.0` o `⭐ Pasajero nuevo.`  
2. Aceptación al pasajero incluye `⭐ Calificación: X.X / 5.0` o `⭐ Conductor nuevo.`  
3. Sin inventar scores; si no hay filas, copy de “nuevo”.  
4. “Mi rendimiento” del conductor usa el mismo agregador de promedio del conductor.

---

### HU-06 — Despacho: publicación de servicio a conductores

**Como** pasajero,  
**quiero** que mi solicitud confirmada se publique a conductores disponibles,  
**para** que alguien acepte el viaje.

#### Tareas

- [ ] Flujo: confirmar cotización → `offerTripToDrivers` → `createTrip` (`SEARCHING`) → `publishTripOffer`.  
- [ ] Lista de conductores elegibles (disponibles, no bloqueados, exclusiones).  
- [ ] Envío WhatsApp 1:1 con botones Aceptar / Rechazar.  
- [ ] Logs de diagnóstico `[publish:diag]` para ubicar cortes (reputación / elegibles / WA).  
- [ ] Verificar migración `034` en el entorno antes de probar publicación.

#### Criterios de aceptación

1. Tras “✅ Solicitar”, el trip existe en BD con estado `SEARCHING`.  
2. Al menos un conductor elegible recibe la oferta en WhatsApp.  
3. Si no hay elegibles, el pasajero recibe aviso claro (no silencio).  
4. Si falla `passenger_ratings`, los logs muestran `STOP_at_reputation_*` (no se oculta el fallo).

---

### HU-07 — Menú principal del conductor post-servicio

**Como** conductor,  
**quiero** volver al menú principal al terminar calificación del pasajero,  
**para** seguir operando (disponibilidad / cuenta / sesión) sin escribir comandos.

#### Tareas

- [ ] Tras `handleDriverRatesPassenger` exitoso (o ya calificado) → `sendDriverMainMenu`.  
- [ ] No crear menú nuevo; reutilizar `src/lib/driver-menu.ts`.  
- [ ] No forzar disponibilidad; leer estado actual del conductor.

#### Criterios de aceptación

1. Flujo: Finalizar → calificar pasajero → confirmación → menú principal inmediato.  
2. Botones: 🟢 Disponible / 🔴 No disponible (según estado), 👤 Mi cuenta, Cerrar sesión.  
3. La conversación del conductor no queda sin opciones tras el servicio.

---

## 6. Orden sugerido de implementación

1. Migraciones `033` + `034` en Supabase.  
2. HU-01 / HU-02 (favoritos + saludo + uso).  
3. HU-04 / HU-05 (reputación + prompts).  
4. HU-06 (validar publicación; corregir solo si el diagnóstico lo confirma).  
5. HU-03 / HU-07 (menús continuos pasajero y conductor).  
6. Prueba E2E del camino crítico (sección 8).

---

## 7. Definition of Done (sprint)

- [ ] Migraciones del sprint aplicadas en el entorno de prueba.  
- [ ] Historias HU-01 … HU-07 con criterios de aceptación verificados en WhatsApp real o staging.  
- [ ] Pasajero puede completar un viaje y quedar con botones de acción.  
- [ ] Conductor puede finalizar, calificar y ver menú principal.  
- [ ] Ofertas llegan a conductores elegibles con reputación del pasajero.  
- [ ] Sin regresiones graves en booking / cancelación / túnel.  
- [ ] Este documento permanece como referencia; cambios de alcance se anotan en sprints posteriores.

---

## 8. Prueba E2E del camino crítico

1. Pasajero: saludo → Solicitar (o favorito) → origen/destino → cotización → Solicitar.  
2. Conductor disponible recibe oferta con origen, destino, tarifa y ⭐ pasajero.  
3. Conductor acepta → pasajero recibe nombre, vehículo y ⭐ conductor.  
4. Ciclo: ETA → Llegué → Iniciar → Finalizar.  
5. Pasajero califica → (opcional) guarda favorito → menú de acción.  
6. Conductor califica pasajero → menú principal.  
7. Pasajero cancela una nueva cotización → menú de acción inmediato.  
8. Nuevo saludo con favoritos (si aplica) sin menú genérico.

---

## 9. Notas de arquitectura

- No hay microservicios: un solo Core Agent en el webhook.  
- “PricingEngine” en producto = `estimateRoute` + `estimateFare` en booking.  
- “DispatchEngine.publishOffer” = `publishTripOffer` en `dispatch.ts`.  
- Estado de trip de búsqueda = `SEARCHING` (no existe `requested`).  
- Promedios de reputación se calculan en lectura; preparados para métricas futuras sin cambiar el flujo actual.  
- Máximo **3** botones por mensaje WhatsApp: con 2 favoritos no cabe Cancelar en la misma pantalla.

---

## 10. Referencias

- Backup estado MVP: `docs/backup/06-estado-mvp.md`  
- Conocimiento funcional: `docs/backup/05-conocimiento-funcional.md`  
- Informe ejecutivo (histórico): `docs/INFORME-ESTADO-WHATXIA-MOBILITY.md`  
- Migraciones: `supabase/migrations/030_*` … `034_*`
