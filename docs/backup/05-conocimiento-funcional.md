# 5. Conocimiento funcional — WhatXia Basic

Documento de transferencia de conocimiento construido durante el desarrollo del MVP. Mapea conceptos de producto a módulos reales del repositorio.

## Visión

WhatXia Mobility es un **MVP de taxi por WhatsApp** (sin app nativa) para **Ibagué**:

- El pasajero solicita, confirma origen/destino y recibe cotización estimada.  
- El sistema despacha a conductores disponibles.  
- El conductor ejecuta el viaje (ETA → llegada → inicio → navegación → fin).  
- La tarifa se estima al inicio y se finaliza al cerrar el viaje (persistencia); al usuario se comunica el **rango estimado** y la regla del taxímetro + recargo de solicitud.  
- Conductores se registran y gestionan disponibilidad/documentos por el mismo canal.

---

## Arquitectura del Core Agent

**Nombre de producto:** Core Agent  
**Implementación:** `src/lib/whatsapp/handler.ts` → `handleIncomingMessage`

Es el orquestador único de entrada. No hay microservicios: un proceso Next.js en Vercel recibe el webhook y enruta por prioridad.

### Capas

```
Meta Webhook
  → verify + parse + normalize (voz)
  → Core Agent (handler)
      → tunnels / rating / cancellations / search timeouts
      → dispatch buttons
      → driver menu / registration / update / docs
      → taximeter test
      → booking (Mobility)
      → greeting / intent / fallback
  → WhatsApp client (salida)
  → Supabase (persistencia)
  → Google Maps / OpenAI (servicios externos)
```

### Conversation Planner (concepto → código)

No existe un paquete llamado `conversation-planner`. La “planificación” es la **máquina de estados** en:

| Persistencia | Código |
|--------------|--------|
| `conversation_sessions.state` + drafts | `src/lib/sessions.ts` |
| Estados de booking | `src/types` + `src/lib/booking/flow.ts` |
| Estados registro conductor | `DRIVER_REGISTERING`, `DRIVER_REGISTRATION_WELCOME`, `PAUSED`, `RESUME_CHOICE`, … |
| Taxímetro | `taximeter_test_sessions.state` |

El planner efectivo = **orden de `if` en el handler** + estado en Supabase.

### Response Generator (concepto → código)

No hay generador LLM de respuestas de negocio. Las respuestas son **plantillas determinísticas**:

- `sendTextMessage` / `sendButtonsMessage` (`src/lib/whatsapp/client.ts`)  
- Copy embebido en booking, dispatch, registration, rating, etc.

Excepción: **voz entrante** usa Whisper (LLM/ASR) solo para convertir audio→texto; el texto entra al mismo pipeline.

---

## Mobility (Booking)

**Código:** `src/lib/booking/flow.ts`, `src/lib/booking/intent.ts`

### Flujo pasajero (happy path)

1. Saludo / menú **o** texto con intención de servicio (`parseMobilityIntent`).  
2. Origen: pregunta “¿Dónde te recogemos?” → pin WhatsApp y/o texto.  
3. Destino: texto → Places (bias ciudad) → confirmación / recuperación.  
4. Cotización: `estimateFare` → presentación de **rango** (`present-estimate.ts`, margen +$3.000).  
5. Confirmación → crea `trip` `SEARCHING` → dispatch.

### Reglas UX relevantes

- No auto-completar “Punto de recogida” sin interacción.  
- Intención libre evita depender siempre de “Hola”.  
- Mensaje de fin de viaje usa el **mismo `quoted_fare`** del inicio (rango), no recalcula para mostrar.

---

## Dispatch

**Código:** `src/lib/dispatch.ts` (+ `search.ts`, `trip-exclusions.ts`, `waiting-flow.ts`)

### Ciclo conductor

Oferta → Aceptar/Rechazar → ETA → Ver ubicación / Llegué → Iniciar → Navegar destino → Finalizar.

### Comportamientos

- Oferta incluye ubicación nativa WhatsApp + rango estimado.  
- Exclusiones tras cancelación/rechazo para reasignar.  
- Timeouts de búsqueda + “continuar / cancelar” (waiting flow).  
- Al finalizar: persiste `final_fare` vía `finalizeFare`, notifica P/D con rango estimado + copy de taxímetro/$800, abre rating, programa cierre de túnel.

---

## Pricing / Tariff Engine

**Código:** `src/lib/tariff/*` (entrada `src/lib/tariff/index.ts`)  
**Legacy:** `src/lib/pricing/*` (deprecado; no SSoT)

### SSoT

| Fuente | Tabla / artefacto |
|--------|-------------------|
| Parámetros | `public.fare_rules` |
| Festivos | `public.holidays` |
| Ciudad | `public.cities` + `src/lib/city/context.ts` |

### API

- `estimateFare` — cotización informativa pre-aceptación.  
- `finalizeFare` — tarifa oficial al terminar viaje.  
- Presentación: `formatEstimatedFareRange*` / `formatCopSymbol`.

### Reglas de negocio tarifarias (Ibagué v2 — resumen)

- Base / piso: tarifa mínima (p. ej. $6.600).  
- Distancia: incrementos sobre excedente tras ~1.600 m; tick 80 m × $90 (`028`).  
- Recargos configurables: nocturno 19:00–06:00, domingo/festivo, aeropuerto, plataforma.  
- Flag `APPLY_CALL_SURCHARGE_ON_ESTIMATE = false`: el recargo de solicitud **no** se suma al estimado mostrado; el copy de fin de viaje recuerda **+$800** sobre taxímetro.  
- UI de estimado: rango `[X, X+3000]` redondeado a centenas.

### Decisión de arquitectura

El motor **no** usa `date-holidays` en runtime; solo lee `holidays` en Supabase. Los archivos `city-config/*.ts` son referencia/seed históricos, no fuente operativa.

---

## Registro de conductores

**Código:** `src/lib/driver-registration.ts`, `src/lib/driver-profile-fields.ts`, `src/lib/supabase/drivers.ts`

### Entrada

Intención conductor (`🚖`, `🚕`, “Soy conductor”, …) → si ya existe driver: menú; si no: registro.

### Inicio

1. Bienvenida + botones **✅ Continuar** / **❌ Abandonar**.  
2. Continuar → primera pregunta.  
3. Abandonar → sin datos.

### Durante el formulario

Botones: **Cancelar inscripción** (borra progreso) / **🚪 Salir** (pausa).  
Reentrada: Continuar donde quedó / Empezar de nuevo.  
Sin mensajes intermedios “dato guardado”.

### Campos (orden actual)

**Personales:** nombre, cédula, email, dirección, ciudad  
**Vehículo:** placa, marca (+ayuda), línea/referencia (+ayuda), color  
**Documentos:** SOAT, técnico-mecánica, tarjeta de operación, licencia de tránsito  

Eliminados del flujo: emergencia, año, tipo de servicio.

### Cierre

Mensaje de recepción + validación manual del equipo (no auto-activar narrativa de “ya puedes recibir servicios” como única verdad de negocio; el código aún puede crear fila `drivers` según `createDriver` — ver estado MVP).

---

## Flujo de pasajeros

1. Identidad = teléfono WhatsApp → `passengers` (findOrCreate).  
2. Sesión conversacional en `conversation_sessions`.  
3. Booking → trip → mensajes de estado → túnel opcional con conductor → fin → rating.  
4. Cancelaciones con menú de causales cuando aplica.

---

## Túneles conversacionales

**Código:** `src/lib/tunnels.ts`  
**Tablas:** `conversation_tunnels`, `tunnel_messages`

Durante el servicio, mensajes no capturados por botones de flujo pueden reenviarse P↔D. Al finalizar: status `closing` + `closes_at`; cron `/api/cron/tunnels` limpia.

---

## Taxímetro de prueba

**Código:** `src/lib/taximeter-test/*`  
**Tablas:** `taximeter_test_sessions`, `taximeter_test_runs`

Calibración de tarifa en campo **sin** crear trips ni despachar. Independiente de Mobility. MVP simplificado: pins inicio/fin → cálculo WhatXia; `meter_value` opcional.

> Nota: el emoji `🚖` bare fue reasignado al **módulo conductor**; no asumir que inicia taxímetro sin revisar handler actual.

---

## Reglas de negocio (lista operativa)

1. Un número WhatsApp puede ser pasajero o conductor según datos/sesión.  
2. Solo conductores `available` / no bloqueados reciben ofertas (según lógica dispatch).  
3. Documentos vencidos pueden marcar `documents_blocked` / `inactive` (cron docs).  
4. Búsqueda tiene deadline; sin conductor → waiting flow.  
5. Cancelaciones acumulan políticas / exclusiones.  
6. Tarifa mostrada al usuario = **estimada en rango**; cobro de calle = taxímetro + $800 solicitud (copy).  
7. Ciudad operativa actual = Ibagué.  
8. Registro conductor puede pausarse; cancelar borra progreso.

---

## Decisiones de arquitectura tomadas

| Decisión | Razón |
|----------|--------|
| Un solo deploy Next + webhook | Simplicidad MVP, un solo secreto surface |
| Supabase + service role | Persistencia rápida sin auth de usuario |
| FSM en DB por teléfono | Conversaciones largas / reanudables |
| Tariff Engine lee solo DB | Multi-ciudad futura sin redeploy de fórmulas |
| Holidays en SQL no en npm runtime | Determinismo y ops en un solo lugar |
| Presentación de rango separada del cálculo | UX sin mutar `quoted_fare` |
| Taxímetro sin trips | Calibración sin contaminar operación |
| Copy determinístico (no LLM de negocio) | Control regulatorio y costos |
| Voz solo en frontera WhatsApp | Mobility permanece agnóstico al canal de audio |
| Sin RLS en migraciones | Velocidad MVP; riesgo aceptado con service role |

---

## Mapa rápido archivo → dominio

| Dominio | Path |
|---------|------|
| Core Agent | `src/lib/whatsapp/handler.ts` |
| WhatsApp I/O | `src/lib/whatsapp/*`, `src/app/api/webhook` |
| Mobility | `src/lib/booking/*` |
| Dispatch | `src/lib/dispatch.ts` |
| Search / waiting | `src/lib/search.ts`, `waiting-flow.ts` |
| Tariff | `src/lib/tariff/*` |
| Geo | `src/lib/geo/*` |
| Drivers | `driver-registration`, `driver-menu`, `driver-update`, `supabase/drivers` |
| Tunnels | `src/lib/tunnels.ts` |
| Cancellations | `src/lib/cancellations.ts` |
| Rating | `src/lib/rating.ts` |
| Voice | `src/lib/voice/*` |
| Taximeter | `src/lib/taximeter-test/*` |
| City | `src/lib/city/context.ts` |
| Crons | `src/app/api/cron/*` |
