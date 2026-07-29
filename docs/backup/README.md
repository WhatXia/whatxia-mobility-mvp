# Backup Integral — WhatXia Basic (Mobility MVP)

**Fecha del backup:** 24 de julio de 2026  
**Repositorio:** https://github.com/WhatXia/whatxia-mobility-mvp  
**Commit documentado (`main`):** `d8a65d7513906117aef52e89d87edd8e344a69ad`  
**Producto:** WhatXia Mobility MVP (`whatxia-mobility-mvp` v0.1.0)  
**Alcance:** Ibagué (Colombia) · Canal WhatsApp Cloud API  

> **Restore point posterior:** el estado estable actual del producto está congelado en  
> **[BACKUP-002](../backups/BACKUP-002.md)** (29 jul 2026, migraciones **001–040**, tag `backup/BACKUP-002`).  
> Esta carpeta (`docs/backup/`) permanece como **BACKUP-001** histórico.

> Sprint de **auditoría y documentación únicamente**.  
> No se modificó código de aplicación, no se ejecutaron migraciones ni se cambiaron configuraciones de infraestructura como parte de este sprint (salvo la creación de esta carpeta `docs/backup/`).

## PDF oficial (consolidado)

| Documento | Archivo |
|-----------|---------|
| **Biblia Técnica MVP v1.0** | [WhatXia-Basic-Biblia-Tecnica-MVP-v1.0.pdf](./WhatXia-Basic-Biblia-Tecnica-MVP-v1.0.pdf) |

Incluye portada, tabla de contenido, resumen ejecutivo, estado del MVP, arquitectura, repositorio, Vercel, Supabase (29 migraciones), WhatsApp/Meta, conocimiento funcional, reglas de negocio, árbol del proyecto, manual de recuperación y próximos pasos. Encabezados, pie de página y numeración incluidos.

Para regenerar: `node scripts/generate-technical-bible.mjs` (requiere `marked` y `puppeteer` en `node_modules`).

## Índice (fuentes Markdown)

| # | Documento | Contenido |
|---|-----------|-----------|
| 1 | [01-repositorio.md](./01-repositorio.md) | GitHub, estructura, commits, deps, scripts, árbol |
| 2 | [02-vercel.md](./02-vercel.md) | Proyecto, env (nombres), crons, build, estado |
| 3 | [03-supabase.md](./03-supabase.md) | Tablas, relaciones, RLS, migraciones 001–029 |
| 4 | [04-whatsapp-meta.md](./04-whatsapp-meta.md) | Webhooks, tokens, flujo, pendientes |
| 5 | [05-conocimiento-funcional.md](./05-conocimiento-funcional.md) | Arquitectura, Mobility, Dispatch, Pricing, registro |
| 6 | [06-estado-mvp.md](./06-estado-mvp.md) | Qué funciona, pendientes, riesgos, próximos pasos |
| 7 | [07-manual-recuperacion.md](./07-manual-recuperacion.md) | Cómo reconstruir el proyecto desde cero |
| — | [arbol-proyecto.txt](./arbol-proyecto.txt) | Árbol de archivos (sin `node_modules` / `.git` / `.next`) |

## Documentación previa relacionada

- `docs/INFORME-ESTADO-WHATXIA-MOBILITY.md` — informe ejecutivo (corte ~23 jul 2026; migraciones hasta 027; este backup actualiza a **029** y a commits posteriores).

## Principio de seguridad

- En este backup **nunca** se documentan valores de secretos.  
- Solo se listan **nombres** de variables de entorno.  
- Los valores viven en Vercel Project Settings y/o `.env.local` local (fuera de Git).
