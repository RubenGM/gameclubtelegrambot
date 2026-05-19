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
| 2 | Preview de subida con acciones visibles | Completado y validado | `a6c06df Improve storage upload review UX`; `node --import tsx --test src/telegram/storage-flow.test.ts` pasó; `npm run typecheck` pasó; `./startup.sh` pasó el 2026-05-19 | Ninguna |
| 3 | Selección de categoría destino más clara | Completado y validado | `a6c06df Improve storage upload review UX`; selector nivel a nivel con `Guardar aquí`; `./startup.sh` pasó el 2026-05-19 | Ninguna |
| 4 | Guía categorías vs tags y aviso sin tags | Completado y validado | `a6c06df Improve storage upload review UX`; copy i18n, aviso `Completar sin tags`, tags flexibles en prompts; `./startup.sh` pasó el 2026-05-19 | Ninguna |
| 5 | Búsqueda: separar buscar vs explorar | Completado y validado; commit pendiente | `npm run typecheck` pasó; `node --import tsx --test src/storage/storage-catalog.test.ts src/telegram/storage-flow.test.ts` pasó; `./startup.sh` pasó el 2026-05-19 | Commit |
| 6 | Búsqueda: evitar listas largas de categorías | Completado y validado junto al paso 5; commit pendiente | Exploración nivel a nivel sin listar todos los descendientes de inicio; tests Storage y `./startup.sh` pasaron | Commit |
| 7 | Descubribilidad de tags en búsqueda | Completado y validado junto al paso 5; commit pendiente | Copy de búsqueda, enlace a tags, normalización `#tag`; tests Storage y `./startup.sh` pasaron | Commit |
| 8 | Taxonomía categorías vs tags | Pendiente | Sin cambios implementados | Documentar criterio en UX/copy y `docs/feature-status.md` si aplica |
| 9 | Validación final del goal | Pendiente | No ejecutado | `npm run typecheck`, tests Storage, `./scripts/feature-status-audit.sh`, `./startup.sh`, auditoría contra `SHINY_TESTING.md` |

## Notas operativas

- No marcar un paso como completado si falta `./startup.sh`.
- Si un paso queda commiteado pero `./startup.sh` no se ha ejecutado por cambios parciales posteriores, mantenerlo como "validación runtime pendiente".
- Mantener este archivo sincronizado con cada commit para que el estado no dependa del chat.
