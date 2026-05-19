# Shiny Testing - estado de implementación

Última actualización: 2026-05-19.

Este archivo acompaña `SHINY_TESTING.md` y debe reflejar el estado real de cada bloque del goal. Actualizarlo después de cada avance, validación y commit.

## Estado global

- Rama: `shiny_testing`.
- Objetivo: completar todas las correcciones de feedback definidas en `SHINY_TESTING.md`.
- Regla de validación: ejecutar `./startup.sh` cada vez que se complete una feature antes de darla por lista.
- Política de commits: un commit por bloque funcional localizado.

## Pasos

| Paso | Bloque | Estado real | Evidencia | Siguiente acción |
| --- | --- | --- | --- | --- |
| 0 | Especificación base | Completado y commiteado | `f3d7bd7 Add shiny testing storage UX spec` | Ninguna |
| 1 | Parser flexible de tags explícitos | Completado y validado | `66cdb29 Accept flexible storage tag input`; `node --import tsx --test src/storage/storage-catalog.test.ts` pasó; `./startup.sh` pasó el 2026-05-19 | Ninguna |
| 2 | Preview de subida con acciones visibles | Completado y validado; commit pendiente | `node --import tsx --test src/telegram/storage-flow.test.ts` pasó; `npm run typecheck` pasó; `./startup.sh` pasó el 2026-05-19 | Commit |
| 3 | Selección de categoría destino más clara | Completado y validado junto al paso 2; commit pendiente | Selector nivel a nivel con `Guardar aquí`; `node --import tsx --test src/telegram/storage-flow.test.ts` pasó; `./startup.sh` pasó el 2026-05-19 | Commit |
| 4 | Guía categorías vs tags y aviso sin tags | Completado y validado junto al paso 2; commit pendiente | Copy i18n, aviso `Completar sin tags`, tags flexibles en prompts; `node --import tsx --test src/telegram/storage-flow.test.ts` pasó; `./startup.sh` pasó el 2026-05-19 | Commit |
| 5 | Búsqueda: separar buscar vs explorar | Pendiente | Sin cambios implementados | Implementar flujo, tests, `./startup.sh`, commit |
| 6 | Búsqueda: evitar listas largas de categorías | Pendiente | Sin cambios implementados | Reusar navegación nivel a nivel, tests, `./startup.sh`, commit |
| 7 | Descubribilidad de tags en búsqueda | Pendiente | Sin cambios implementados | Copy, normalización de `#tag`, tags visibles, tests, `./startup.sh`, commit |
| 8 | Taxonomía categorías vs tags | Pendiente | Sin cambios implementados | Documentar criterio en UX/copy y `docs/feature-status.md` si aplica |
| 9 | Validación final del goal | Pendiente | No ejecutado | `npm run typecheck`, tests Storage, `./scripts/feature-status-audit.sh`, `./startup.sh`, auditoría contra `SHINY_TESTING.md` |

## Notas operativas

- No marcar un paso como completado si falta `./startup.sh`.
- Si un paso queda commiteado pero `./startup.sh` no se ha ejecutado por cambios parciales posteriores, mantenerlo como "validación runtime pendiente".
- Mantener este archivo sincronizado con cada commit para que el estado no dependa del chat.
