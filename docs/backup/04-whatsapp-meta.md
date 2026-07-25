# 4. WhatsApp Cloud API / Meta

## Estado de integración

| Ítem | Estado |
|------|--------|
| Recepción de mensajes (webhook) | Operativo |
| Envío texto / botones / location request | Operativo |
| Verificación GET + firma POST HMAC | Operativo |
| Notas de voz → Whisper → mismo flujo | Operativo si hay `OPENAI_API_KEY` |
| Multi-número / plantillas HSM | No documentado como parte del MVP core |
| WhatsApp Business App dual-role | Mismo número atiende pasajero y conductor |

## Endpoint del producto

| Método | Path | Rol |
|--------|------|-----|
| `GET` | `/api/webhook` | Verificación Meta (`hub.mode`, `hub.verify_token`, `hub.challenge`) |
| `POST` | `/api/webhook` | Eventos entrantes (mensajes) |

Implementación: `src/app/api/webhook/route.ts`.

URL de producción típica:

```text
https://<dominio-vercel>/api/webhook
```

Configurar esa URL en Meta → App → WhatsApp → Configuration → Webhook.

## Tokens y secretos requeridos (nombres)

| Variable | Uso |
|----------|-----|
| `WHATSAPP_TOKEN` | Bearer hacia Graph API (enviar mensajes, descargar media) |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número Business |
| `WHATSAPP_VERIFY_TOKEN` | Debe coincidir con el verify token configurado en Meta (GET) |
| `WHATSAPP_APP_SECRET` | Valida `X-Hub-Signature-256` en POST |
| `WHATSAPP_API_VERSION` | Versión Graph; default `v21.0` |

Opcionales para voz:

| Variable | Uso |
|----------|-----|
| `OPENAI_API_KEY` | Transcripción Whisper |
| `OPENAI_WHISPER_MODEL` | Default `whisper-1` |
| `OPENAI_WHISPER_LANGUAGE` | Default `es` |
| `VOICE_TRANSCRIPTION_PROVIDER` | Default `openai_whisper` |

## Configuración actual (desde código)

1. **GET verify:** si `hub.mode=subscribe` y token == `WHATSAPP_VERIFY_TOKEN` → responde `hub.challenge` (200).  
2. **POST:** lee body raw → verifica firma (`src/lib/whatsapp/verify.ts`) → parse (`parse.ts`) → normalize (audio→texto en `normalize-incoming.ts`) → `handleIncomingMessage`.  
3. **Envío:** `src/lib/whatsapp/client.ts` usa Graph `/{PHONE_NUMBER_ID}/messages`.  
4. **Media:** `src/lib/whatsapp/media.ts` descarga audio con el token.

## Flujo de mensajes (alto nivel)

```
Usuario WhatsApp
  → Meta Cloud API
  → POST /api/webhook
  → verify signature
  → parseIncomingMessages
  → normalizeParsedMessage (voz → texto)
  → handleIncomingMessage (Core Agent)
  → módulos (booking / dispatch / drivers / tunnels / …)
  → sendTextMessage / sendButtonsMessage / location request
  → Meta → Usuario
```

### Tipos de interacción soportados

- Texto libre (saludo, intención de viaje, intención conductor, respuestas de formulario).  
- Botones interactivos (reply buttons; título ≤ 20 caracteres Meta).  
- Ubicación (pin) + location request.  
- Audio (nota de voz) si Whisper está configurado.

## Mapeo de “superficie” WhatsApp → módulos

| Entrada usuario | Módulo |
|-----------------|--------|
| Menú pasajero / “Solicitar servicio” / intención viaje | `booking/*` |
| Botones conductor (aceptar, ETA, llegar, iniciar, navegar, finalizar) | `dispatch.ts` |
| `🚖` / `🚕` / “Soy conductor”… | Menú conductor o registro |
| Registro Continuar/Abandonar/Cancelar/Salir | `driver-registration.ts` |
| Taxímetro de prueba (sesión/botones) | `taximeter-test/*` |
| Chat durante viaje | `tunnels.ts` |
| Cancelaciones / Ya voy | `cancellations.ts` |
| Rating | `rating.ts` |

## Pendientes conocidos (Meta / canal)

1. **Plantillas proactivas / fuera de ventana 24h** — no son el foco del MVP actual (conversación reactiva).  
2. **Límite de botones** — máximo 3 reply buttons; títulos cortos (p. ej. “Cancelar inscripción” sin emoji ❌).  
3. **Confiabilidad de webhooks** — Meta reintenta; el handler responde 200 incluso si hay error interno (log + swallow) para evitar tormentas; revisar logs Vercel ante fallos silenciosos.  
4. **Voz** — sin `OPENAI_API_KEY` las notas de voz no entran al flujo.  
5. **Número único** — pasajero y conductor comparten el mismo WABA number; el routing es por rol (existencia en `drivers` + estado de sesión).  
6. **Taxímetro vs módulo conductor** — `🚖`/`🚕` bare abren módulo conductor; el taxímetro de prueba se usa vía sesión/botones (no necesariamente el emoji bare). Confirmar UX operativa vigente en código de handler.

## Checklist Meta al recuperar entorno

1. App Meta con producto WhatsApp.  
2. Número de prueba o producción vinculado.  
3. Webhook URL + Verify Token.  
4. Suscripción al campo `messages`.  
5. Copiar Phone Number ID, Permanent Token (o System User token), App Secret a Vercel.  
6. Probar GET challenge y un mensaje “Hola”.
