# Plan de ejecución – Feature `Grupos de noticias`

## Objetivo
Hacer que `Grupos de noticias` sea **operativo completo** y estable en producción, con `/news` gestionable por admin vía comandos y botones, catálogo de categorías único, y publicación por categorías coherente en agenda/LFG/préstecs.

## Estado base
- Existe base funcional, pero hay que validar: callbacks, catálogo único, i18n y publicación por categorías sin huecos.
- Punto de verdad operacional: `docs/feature-status.md`.

## Entregables obligatorios

1) Modelo y catálogo de categorías
- Consolidar/confirmar en `src/news/news-group-catalog.ts`:
  - claves canónicas, aliases, labels y descripciones.
  - resolución (`resolve...`), normalización (`normalize...`) y helpers de listado.
- Definir migración/semántica para claves legacy si hay cambios de nombre.

2) `/news` (texto + botones) 
- `src/telegram/news-group-flow.ts`
  - comandos: `/news`, `status`, `help`, `enable/on`, `disable/off`, `subscribe`, `unsubscribe` + aliases por idioma.
  - callbacks:
    - `news_group:toggle`
    - `news_group:refresh`
    - `news_group:subscribe:<key>`
    - `news_group:unsubscribe:<key>`
  - persistencia automática de grupo al activar/editar suscripciones.
  - mensajes con estado + teclado inline construido desde catálogo + idioma.

3) Registro en runtime
- `src/telegram/runtime-boundary-registration.ts`
  - registrar callbacks de `news_group` (sin rutas huérfanas).

4) Publicación por categorías por módulo
- `src/telegram/schedule-notifications.ts`: agenda => `events`.
- `src/telegram/lfg-flow.ts`: LFG jugadores/grupos.
- `src/telegram/catalog-loan-flow.ts`: préstamos por tipo.
- Confirmar que `listSubscribedGroupsByCategory` no notifica a grupos no suscritos.

5) i18n completa
- `src/telegram/i18n.ts`:
  - `ca/es/en`: textos del `help`, modo, comandos, mensajes de estado/suscripción.
  - textos de botones: habilitar, deshabilitar, suscribir, desuscribir, refrescar.
  - `categoryUnknown`/`categoryRequired` para UX robusta.

6) UX y permisos
- Respetar `isAdmin` como gate real para gestión.
- Mantener mensajes de ayuda compatibles con texto plano.
- Evitar textos internalizados en botones (sin SLUGs), usar labels amigables.

7) Cobertura y regresiones
- `src/telegram/news-group-flow.test.ts`: callbacks + comandos + permisos + errores de categoría.
- `src/telegram/runtime-boundary.test.ts`: registro de callbacks esperado.
- tests de publicación por categoría:
  - `src/telegram/schedule-flow.test.ts`
  - `src/telegram/lfg-flow.test.ts`
  - `src/telegram/catalog-loan-flow.test.ts`

8) Cierre operacional
- Actualizar `docs/feature-status.md` (fila de resumen y bloque de la feature).
- Ajustar bloque de ejecución y riesgos abiertos.
- Ejecutar `./scripts/feature-status-audit.sh`.
- Si cambia ejecución, `./startup.sh` y validar mensajes reales en grupo.

## Plan de trabajo por fases
1. Normalización y flujo de control (`news-group-catalog.ts`, `news-group-flow.ts`).
2. Integración con runtime y módulos productores (`runtime-boundary-registration.ts`, `schedule-notifications.ts`, `lfg-flow.ts`, `catalog-loan-flow.ts`).
3. i18n + UX/admin-only + tests.
4. Validación final, `feature-status` y despliegue.

## Criterios de aceptación
- `/news` funciona por texto y botones en grupos.
- Alta/baja de subscripción por categoría funciona por comando y callback.
- Notificaciones solo a grupos suscritos a la categoría correspondiente.
- No regresiones en `/news` legacy (alias idiomas).
- Textos, botones y errores consistentes en `ca/es/en`.
- Estado en `docs/feature-status.md` pasa a operativo con bloque técnico limpio.

## Riesgos
- Categorías desconocidas por mensajes antiguos en BD.
- Grupos desactivados con suscripciones persistidas.
- Cambios de catálogo con alias ambiguos.
- Divergencia entre `messageText` y `callback_data`.
