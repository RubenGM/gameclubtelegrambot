# Arquitectura del proyecto

## Alcance

`gameclubtelegrambot` es un único servicio Node.js y TypeScript. Dentro del mismo
proceso mantiene el bot de Telegram, el servidor HTTP administrativo/público y
los workers periódicos. PostgreSQL es la persistencia principal y Drizzle define
el esquema y las migraciones.

No existe una aplicación frontend desplegada por separado.

## Arranque y ciclo de vida

```text
src/main.ts
    |
    v
src/main-program.ts
    |
    +-- resuelve runtime.json + config/.env
    +-- ejecuta el bootstrap interactivo si es el primer arranque
    |
    v
src/bootstrap/create-app.ts
    |
    +-- infraestructura PostgreSQL
    +-- boundary de Telegram y long polling
    +-- workers periódicos
    +-- Admin HTTP server en 127.0.0.1:8787
```

`createApp()` inicia y detiene estas piezas como un solo ciclo de vida. Un fallo
de inicialización cierra lo que ya se hubiera abierto para evitar un servicio
parcial.

## Componentes

| Componente | Responsabilidad | Rutas principales |
| --- | --- | --- |
| Bootstrap y configuración | Detectar primer arranque, validar configuración y crear servicios | `src/bootstrap/`, `src/config/` |
| Telegram | Registrar comandos, callbacks, mensajes, menús, sesiones y permisos | `src/telegram/` |
| Persistencia | Conexión PostgreSQL, schema Drizzle y migraciones | `src/infrastructure/database/`, `drizzle/` |
| Admin HTTP server | Web pública, formularios y panel admin protegido | `src/http/` |
| Dominios | Reglas y repositorios por capacidad | `src/catalog/`, `src/schedule/`, `src/role-games/`, etc. |
| Operación | Backups, estado del servicio, TUI y bandeja Debian | `src/operations/`, `src/tui/`, `src/tray/`, `scripts/` |

Los módulos de dominio principales son acceso y membresía, mesas, catálogo y
préstamos, Agenda, eventos del local, noticias, Avisos, compras conjuntas, LFG,
Rol, Storage, impresión, generación de imágenes y auditoría.

## Boundary de Telegram

`src/telegram/runtime-boundary.ts` adapta grammY al contrato interno.
`runtime-boundary-registration.ts` registra los handlers y fija su precedencia.
Los flujos `*-flow.ts` contienen las conversaciones de cada dominio y usan
repositorios inyectados mediante el contexto runtime.

Las sesiones conversacionales se persisten en `app_metadata`. Esto permite
continuar flujos tras reinicios, pero cada handler debe volver a comprobar
estado y permisos antes de escribir.

Las reglas relevantes son:

- el acceso depende del estado real del usuario y de permisos globales;
- las operaciones administrativas requieren elevación o autorización explícita;
- las menciones LLM de grupo aceptadas no publican resultados en el grupo;
- las escrituras LLM se reconducen a flujos privados con confirmación;
- los topics se identifican por `chat_id` y `message_thread_id`.

El contrato completo de lenguaje natural vive en
[`llm-natural-language.md`](llm-natural-language.md).

## Persistencia

`src/infrastructure/database/schema.ts` es el schema central. Las migraciones SQL
y snapshots Drizzle viven en `drizzle/`; no se modifica una migración ya
aplicada para representar un cambio nuevo.

Los repositorios `*-store.ts` aíslan el acceso a PostgreSQL. Los ficheros,
adjuntos y referencias de Telegram se indexan en Storage, pero Telegram conserva
el contenido binario cuando se guarda un `file_id`.

Los secretos no se guardan en tablas ni en `runtime.json`:

- `runtime.json` contiene configuración no secreta y referencias operativas;
- `config/.env` contiene tokens, contraseñas y credenciales;
- los tokens Notion por campaña se cifran antes de persistirse;
- los hashes y secretos nunca deben aparecer en HTML, logs ni respuestas HTTP.

## Workers

El proceso inicia workers internos para:

- recordatorios de Agenda, préstamos y compras conjuntas cada minuto;
- expiración de Avisos, comprobada como máximo una vez cada quince minutos;
- materialización automática de sesiones recurrentes de Rol cada minuto, si la
  feature está activada;
- reconciliación de Google Calendar cada cinco minutos cuando hay cuenta de
  servicio configurada.

Los fallos periódicos se registran sin detener el long polling. Agenda sigue
siendo la fuente de verdad para Google Calendar.

## Admin HTTP server

El backend escucha únicamente en `127.0.0.1:8787`. Nginx publica las rutas
permitidas mediante HTTPS; el puerto 8787 no debe exponerse en el router.

Las rutas públicas incluyen `/`, `/feedback`, `/alta`, `/club`,
`/actividades` y `/catalogo`. `/admin` y sus subsecciones requieren sesión
firmada y contraseña de elevación. Las acciones POST administrativas usan CSRF y
las acciones destructivas relevantes añaden confirmación textual.

## Integraciones externas

| Integración | Uso | Propiedad de los datos |
| --- | --- | --- |
| Telegram Bot API | Mensajes, callbacks, media y long polling | Telegram entrega eventos; PostgreSQL guarda estado e índices |
| Google Calendar | Copia de actividades futuras | Agenda es la autoridad; no se importan ediciones de Google |
| Notion | Materiales de campañas de Rol | Importación explícita; los webhooks sólo marcan cambios |
| BGG, Open Library y Wikipedia | Enriquecimiento de catálogo | El catálogo local es la autoridad final |
| DeepL y Codex | Traducción, interpretación y generación | Son ayudas; permisos y escrituras se resuelven localmente |
| CUPS y Bot API local | Impresión y descarga de archivos grandes | Los trabajos quedan auditados en PostgreSQL |

Codex y OpenCode nunca se ejecutan directamente desde el servicio: se usan
`scripts/codex-cawa.sh` y `scripts/opencode-cawa.sh`, configurados mediante
`GAMECLUB_CODEX_BIN` y `GAMECLUB_OPENCODE_BIN`.

## Despliegue

`startup.sh` es la entrada habitual. Construye el proyecto, sincroniza la copia
en `/opt/gameclubtelegrambot`, valida configuración, aplica migraciones y
reinicia `gameclubtelegrambot.service`. La unidad systemd, el timer de backups y
el servicio opcional de Bot API local viven en `deploy/systemd/`.

Para los procedimientos exactos, consulta
[`debian-service-operations.md`](debian-service-operations.md) y
[`backup-restore-recovery.md`](backup-restore-recovery.md).
