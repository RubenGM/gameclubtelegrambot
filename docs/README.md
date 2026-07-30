# Índice de documentación

Este directorio reúne la documentación mantenida del proyecto. El código y las
migraciones siguen siendo la autoridad técnica final; cuando cambie una
capacidad, su documentación debe actualizarse en el mismo cambio.

## Por dónde empezar

| Necesidad | Documento |
| --- | --- |
| Qué hace actualmente el bot y qué queda pendiente | [`feature-status.md`](feature-status.md) |
| Cómo está organizado el servicio | [`architecture.md`](architecture.md) |
| Cómo desarrollar, probar y desplegar cambios | [`development-and-validation.md`](development-and-validation.md) |
| Configuración, secretos y variables de entorno | [`runtime-configuration.md`](runtime-configuration.md) |
| Web pública y panel administrativo | [`admin-http-server.md`](admin-http-server.md) |
| Operación del servicio Debian | [`debian-service-operations.md`](debian-service-operations.md) |
| Backup, restauración y recuperación | [`backup-restore-recovery.md`](backup-restore-recovery.md) |

## Producto e integraciones

- [`llm-natural-language.md`](llm-natural-language.md): `/ask`, fallback
  privado, menciones de grupo, permisos, modelos y ejecución mediante Codex.
- [`google-calendar.md`](google-calendar.md): sincronización unidireccional
  entre Agenda y Google Calendar.
- [`role-game-notion.md`](role-game-notion.md): fuentes Notion por campaña,
  importación revisada y webhooks.
- [`image-generation.md`](image-generation.md): generación de imágenes desde
  Telegram, referencias, permisos y ejecución con Codex.
- [`telegram-local-bot-api-printing.md`](telegram-local-bot-api-printing.md):
  arquitectura del Bot API local usado para archivos de impresión grandes.
- [`telegram-local-bot-api-configuration.md`](telegram-local-bot-api-configuration.md):
  credenciales, activación y prueba del Bot API local.

## UX e interfaces

- [`telegram-pagination-style.md`](telegram-pagination-style.md): patrones
  obligatorios para listas y navegación paginada.
- [`telegram-editable-progress.md`](telegram-editable-progress.md): mensajes de
  progreso editables para operaciones lentas.
- [`brand-guidelines.md`](brand-guidelines.md): identidad, componentes,
  accesibilidad y seguridad visual de la web pública y el panel admin.
- [`admin-console-tui.md`](admin-console-tui.md): consola administrativa
  Textual.
- [`debian-tray-operations.md`](debian-tray-operations.md): bandeja de
  escritorio y control del servicio.

## Instalación y bootstrap

- [`bootstrap-wizard.md`](bootstrap-wizard.md): primer arranque interactivo,
  validación y persistencia inicial.
- [`runtime-configuration.md`](runtime-configuration.md): contrato de
  `runtime.json`, `config/.env` y configuración editable.
- [`debian-service-operations.md`](debian-service-operations.md): instalación,
  systemd, logs y recuperación operativa.

## Especificaciones y documentos históricos

`docs/superpowers/specs/` contiene diseños y planes fechados. Sirven para
entender decisiones, pero describen el alcance previsto en el momento de su
redacción y no sustituyen a `feature-status.md`, a las guías operativas ni al
código actual.

Los planes de la raíz (`PLAN_GESTION_PERSONAJES_ROL.md`, `RPG_UPDATE.md`,
`llm-command-spec.md`, `web_integrada_plan.md` y `web_progress.md`) son
documentos de diseño o handoff históricos. No deben usarse como inventario
operativo.

## Regla de mantenimiento

Al cambiar comportamiento:

1. Actualizar `feature-status.md`, incluso para textos, permisos u onboarding.
2. Actualizar la guía especializada si cambia su contrato.
3. Actualizar `README.md` o este índice si aparece una capacidad o documento
   principal nuevo.
4. Actualizar la tabla de pruebas del inventario cuando cambie la cobertura.
5. Ejecutar `./scripts/feature-status-audit.sh` y el flujo de validación descrito
   en [`development-and-validation.md`](development-and-validation.md),
   incluido `npm run docs:check`.
