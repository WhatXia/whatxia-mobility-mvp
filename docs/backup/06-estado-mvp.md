# 6. Estado actual del MVP

**Corte:** 24 de julio de 2026 · `main` @ `d8a65d7` · migraciones hasta **029**.

## Qué funciona

| Capacidad | Notas |
|-----------|--------|
| Webhook WhatsApp verify + firma + parse | `/api/webhook` |
| Menú pasajero / menú conductor | Mismo número WABA |
| Solicitud de servicio (menú + texto libre + voz si hay key) | Mobility booking |
| Origen (pin/texto) y destino (Places + confirmación) | Geo Google |
| Cotización estimada con rango +$3.000 | Sin recargo $800 en el estimado |
| Creación de trip + búsqueda + oferta | Dispatch |
| Aceptar / rechazar / ETA / llegar / iniciar / navegar / finalizar | Ciclo conductor |
| Mensajes de fin con rango estimado + copy taxímetro/$800 | Usa `quoted_fare` |
| Reasignación / exclusiones / waiting flow | Search timeouts |
| Cancelaciones + políticas | Pasajero y conductor |
| Túnel P↔D + cierre programado | Cron tunnels |
| Rating post-viaje | Pasajero |
| Registro conductor (welcome Continuar/Abandonar, cancel/salir/resume) | Formulario nuevo 029 |
| Actualización de datos / docs vencidos + cron documentos | Drivers |
| Tariff Engine SSoT (`fare_rules` + `holidays`) | Ibagué v2 |
| Taxímetro de prueba (calibración, sin trips) | Tablas 025–027 |
| City context Ibagué | `cities` |

## Qué está pendiente

| Ítem | Detalle |
|------|---------|
| Panel admin / BI | No existe UI operativa |
| Multi-ciudad en runtime | Modelo listo; ops = Ibagué |
| Analytics / rendimiento conductor | Stubs en menú (“Pronto…”) |
| Reportes conductor | Stub |
| README de producto | Sigue siendo boilerplate Next |
| Landing web de producto | No es el canal real |
| RLS / Auth Supabase | No implementados en migraciones |
| Captura taxímetro físico en calibración | Opcional/null en MVP |
| Cron search en `vercel.json` | Solo documents + tunnels; search también vía webhook |
| Términos y Condiciones / tratamiento de datos en registro | Explícitamente aplazado |
| Flujo de aprobación conductor (ops humana) | Mensaje de “validación del equipo”; automatización de aprobación pendiente de producto |
| Calibración estadística tarifa en calle | Taxímetro listo; falta muestra N corridas |
| Dominios/secrets de prod en este backup | Confirmar en dashboards (no versionados) |

## Bugs / fricciones conocidas o de diseño

| Tema | Descripción |
|------|-------------|
| Handler responde 200 ante error interno | Evita reintentos agresivos de Meta; puede “tragarse” fallos → vigilar logs |
| Destinos ambiguos Places | Recuperación UX existe; aún hay riesgo de mal match |
| Dual rol mismo número | Edge cases si un conductor pide viaje como pasajero en paralelo |
| `🚖` vs taxímetro | Intención bare abre módulo conductor; no confundir con inicio de taxímetro |
| Informe previo desactualizado | `docs/INFORME-ESTADO-…` corta en 027; este backup es la referencia a 029 |
| Sin RLS | Riesgo si se filtra anon key o se abre API client-side |
| Dependencia webhooks | Caídas Meta/Vercel = bot caído |

## Riesgos

1. **Tarifa / confianza de negocio** — estimado vs taxímetro real aún en calibración.  
2. **Secretos** — service role + WhatsApp token en Vercel; sin RLS.  
3. **Geo** — calidad de Places/Routes en Ibagué.  
4. **Ops manual** — aprobación de conductores y soporte sin panel.  
5. **Ventana 24h WhatsApp** — mensajes proactivos limitados sin plantillas.  
6. **Conocimiento en chat** — mitigado por este backup; mantener docs al día.

## Madurez (estimación)

| Dimensión | Nivel |
|-----------|--------|
| Piloto controlado 1 ciudad | ~75–85% |
| Expansión multi-ciudad + panel | ~40% |
| Cumplimiento/docs legales en flujo | Bajo (pendiente T&C) |

## Próximos pasos recomendados

1. **Ops:** aplicar migración **029** en todos los entornos; verificar `fare_rules` v2 e `email`/`operation_expires_at`.  
2. **Calibración:** protocolo de corridas con taxímetro de prueba + análisis de sesgo.  
3. **Producto registro:** T&C / datos personales; alinear status `drivers` con “pendiente de aprobación”.  
4. **Hardening:** RLS mínimos o rotación de keys; alertas en Vercel/Supabase.  
5. **Cron search** opcional en `vercel.json` si se quiere independencia del tráfico webhook.  
6. **Documentación viva:** actualizar este backup tras cada sprint de infraestructura.

## Referencias internas

- Conocimiento funcional: [05-conocimiento-funcional.md](./05-conocimiento-funcional.md)  
- Recuperación: [07-manual-recuperacion.md](./07-manual-recuperacion.md)  
- Informe ejecutivo previo: `docs/INFORME-ESTADO-WHATXIA-MOBILITY.md`
