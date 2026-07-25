# 1. Repositorio (GitHub)

## Identidad

| Campo | Valor |
|-------|--------|
| Organización / repo | `WhatXia/whatxia-mobility-mvp` |
| URL | https://github.com/WhatXia/whatxia-mobility-mvp |
| Remote `origin` | `https://github.com/WhatXia/whatxia-mobility-mvp.git` |
| Rama principal | `main` |
| HEAD documentado | `d8a65d7513906117aef52e89d87edd8e344a69ad` |
| Mensaje HEAD | `refactor(mobility): align trip completion fare messaging` |
| Nombre npm | `whatxia-mobility-mvp` |
| Versión package | `0.1.0` |
| Privacidad | Verificar en GitHub (CLI `gh` no disponible en el entorno de auditoría) |

## Ramas relevantes

| Rama | Notas |
|------|--------|
| `main` | Rama de trabajo y despliegue esperada |
| `backup/mobility-mvp-v0.1` | Backup histórico; en el entorno local aparecía *ahead 1* respecto a su remote |

## Estado del código (corte del backup)

- Working tree alineado con `main`…`origin/main` en el momento de la auditoría (sin divergencia reportada por `git status -sb`).
- Stack: **Next.js 16.2.10**, **React 19.2.4**, **TypeScript 5**, **Supabase JS 2.x**.
- Producto real = bot WhatsApp (`src/lib/**` + `src/app/api/webhook`). La página web (`src/app/page.tsx`) es landing starter de Next, no el producto de negocio.

## Dependencias (`package.json`)

### Runtime

| Paquete | Rol |
|---------|-----|
| `next` | Framework / App Router / API routes |
| `react` / `react-dom` | UI (mínima; producto es API + WhatsApp) |
| `@supabase/supabase-js` | Cliente Supabase (service role en servidor) |

### Dev

| Paquete | Rol |
|---------|-----|
| `typescript` | Tipado |
| `eslint` / `eslint-config-next` | Lint |
| `@types/*` | Tipos |
| `date-holidays` | Solo seed de festivos (script); **no** runtime del Tariff Engine |

## Scripts npm

| Script | Comando | Uso |
|--------|---------|-----|
| `dev` | `next dev -p 3002` | Desarrollo local (puerto **3002**) |
| `build` | `next build` | Build producción (Vercel) |
| `start` | `next start -p 3002` | Servir build local (puerto **3002**) |
| `lint` | `eslint` | Lint |

No hay scripts `test` / `certify` en `package.json`. Existen archivos `*.certify.ts` ejecutables vía `npx tsx` / Node según convención del equipo.

## Scripts auxiliares (`scripts/`)

| Archivo | Propósito |
|---------|-----------|
| `diagnose-dispatch-schema.mts` | Diagnóstico de esquema de despacho |
| `generate-co-holidays-sql.ts` | Genera SQL seed de festivos CO (alimentó migración 024) |
| `places-ibague-diag.ts` | Diagnóstico Places Ibagué |
| `wa-offer-location-probe.ts` | Sondeo de ofertas/ubicación WhatsApp |

## Estructura de alto nivel

```
whatxia-mobility-mvp/
├── docs/                  # Documentación (incluye este backup)
├── public/                # Assets estáticos Next
├── scripts/               # Utilidades ops / diagnóstico
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── webhook/   # Meta WhatsApp webhook
│   │   │   └── cron/      # documents, tunnels, search
│   │   ├── layout.tsx
│   │   └── page.tsx       # Landing starter (no producto)
│   ├── lib/               # Dominio: booking, dispatch, tariff, drivers, …
│   └── types/
├── supabase/
│   ├── migrations/        # 001 … 029
│   └── APPLY_SPRINT_18.sql
├── .env.example
├── package.json
├── vercel.json            # Crons Vercel
├── next.config.ts
├── tsconfig.json
├── AGENTS.md / CLAUDE.md  # Notas para agentes (Next breaking changes)
└── README.md              # Aún boilerplate create-next-app
```

Árbol detallado de archivos: [arbol-proyecto.txt](./arbol-proyecto.txt).

## Commits relevantes (historial reciente de `main`)

Orden: más reciente primero (corte del backup).

| Commit | Tema |
|--------|------|
| `d8a65d7` | Mensajes de fin de viaje: rango estimado (no tarifa final) |
| `45f9628` | Formulario registro conductor + schema email/tarjeta operación |
| `51d57c7` | Inicio registro: Continuar / Abandonar |
| `57e0e94` / `6186a31` | Mensaje final registro + sin confirmaciones intermedias |
| `2dcda30` | Cancelar inscripción / Salir / reanudar |
| `f62c7e1` | Intent conductor `🚖`/`🚕` → menú o registro |
| `11d40ef` / `91f291d` / `4c44fa5` | Rango de tarifa estimada (pasajero/conductor) |
| `a355aee` | Flag: sin recargo de solicitud en estimado |
| `b5f104e` / `028` | Tarifa Ibagué v2 (mínimo 1600 m, tick $90) |
| `c594367`…`cb5dee5` | Taxímetro de prueba |
| `0371750` | Voz WhatsApp → Whisper E2E |
| `e8f8416` / `a2e67f7` | Intención de viaje en texto libre |
| `5117bd9`…`b9893d7` | Tariff SSoT + nocturno + holidays |
| `1d8f7a1`… | Destination recovery / Places UX |
| Sprints 13–21 (históricos) | Trips, passengers, tunnels, cancelaciones, search |

Para listado completo: `git log --oneline`.

## Variables de entorno documentadas en repo

Fuente canónica de **nombres**: `.env.example` (+ extras vistos en entorno local de desarrollo).

Ver [02-vercel.md](./02-vercel.md) y [07-manual-recuperacion.md](./07-manual-recuperacion.md).

## Notas para agentes / Next

- `AGENTS.md` / `CLAUDE.md`: esta versión de Next puede diferir del entrenamiento; consultar docs en `node_modules/next/dist/docs/` antes de cambios de API.
