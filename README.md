<div align="center">

<img src="./cawa_logo.svg" alt="CAWA Girona" width="220">

# Game Club Telegram Bot

Bot de Telegram y portal web integrado para gestionar el día a día de un club
de juegos.

[Funciones](#funciones) · [Inicio rápido](#inicio-rápido) ·
[Arquitectura](#arquitectura) · [Operación](#despliegue-y-operación) ·
[Documentación](#documentación)

</div>

## Visión general

El proyecto es un servicio Node.js y TypeScript con PostgreSQL, Drizzle y
grammY. El mismo proceso mantiene:

- el bot privado y de grupos mediante long polling;
- la web pública y el panel administrativo;
- los recordatorios, expiraciones y sincronizaciones periódicas;
- la integración con servicios como Google Calendar, Notion, Codex y CUPS.

Está diseñado para ejecutarse como `gameclubtelegrambot.service` en Debian. La
fuente de verdad funcional es
[`docs/feature-status.md`](docs/feature-status.md).

## Funciones

| Área | Capacidades principales |
| --- | --- |
| Acceso y administración | Solicitudes, aprobación, bloqueo, autojoin, permisos globales, elevación admin y bienvenidas de grupo |
| Agenda y local | Actividades, asistentes, reservas, mesas, conflictos, promociones, recordatorios y eventos del local |
| Catálogo | Juegos, libros, expansiones, posiciones físicas, familias, media, préstamos y enriquecimiento desde BGG, Open Library o Wikipedia |
| Comunidad | Noticias por grupos/topics, Avisos, compras conjuntas y búsqueda de jugadores LFG |
| Rol | Campañas, miembros, personajes, sesiones, recurrencia, handouts privados y fuentes Notion revisadas |
| Storage | Archivo de adjuntos, categorías, búsquedas, permisos y reutilización desde otros módulos |
| IA | Consultas en lenguaje natural, planificación admin separada, modelos configurables y generación de imágenes |
| Impresión | PDF, Office e imágenes desde Telegram o Storage, permisos, modo prueba, CUPS y Bot API local opcional |
| Web integrada | Portada, club, actividades, catálogo, feedback, alta de socios y panel admin protegido |
| Operación | Configuración guiada, migraciones, backups, restauración, TUI, bandeja Debian y métricas de UX |

El bot adapta menús, ayuda y permisos al estado del usuario, al chat y al flujo
activo. Los textos y teclados principales soportan catalán, español e inglés.

> [!NOTE]
> No todas las capacidades tienen el mismo alcance. El inventario documenta
> expresamente qué está operativo, parcial o pendiente y separa las pruebas
> automatizadas de las validaciones externas o físicas.

## Arquitectura

```text
Telegram ──> grammY / runtime boundary ──> flujos de dominio ──> PostgreSQL
                         │                       │
                         │                       ├── Google Calendar / Notion
                         │                       ├── BGG / Open Library / Wikipedia
                         │                       ├── Codex / DeepL
                         │                       └── CUPS / Bot API local
                         │
Nginx + HTTPS ──> Admin HTTP server (127.0.0.1:8787)
```

`src/main.ts` arranca el ciclo de vida definido en `src/bootstrap/create-app.ts`.
Los dominios viven en módulos propios bajo `src/`; el registro y la precedencia
de handlers de Telegram se concentran en `src/telegram/`; el Admin HTTP server
vive en `src/http/`.

Consulta [`docs/architecture.md`](docs/architecture.md) para el detalle de
componentes, persistencia, workers, seguridad e integraciones.

## Requisitos

- Node.js 20.19 o posterior.
- npm.
- PostgreSQL.
- Docker y Docker Compose para la preparación local automatizada.
- Un token de bot de Telegram.

Algunas funciones requieren dependencias o credenciales adicionales:

- cuenta de servicio de Google Calendar, configurable mediante archivo JSON
  desde `Admin → Google Calendar`;
- integración de Notion y clave de cifrado;
- Codex para lenguaje natural y generación de imágenes;
- CUPS, LibreOffice e ImageMagick para impresión;
- Telegram Bot API local para descargar documentos grandes.

## Inicio rápido

```bash
npm install
npm run init:local
npm run start:local
```

`npm run init:local` prepara PostgreSQL en `127.0.0.1:55432`, genera
`config/runtime.local.json`, crea el entorno local y aplica migraciones.

Si ya tienes token:

```bash
GAMECLUB_TELEGRAM_TOKEN="..." npm run init:local
```

Para desarrollo con recarga:

```bash
npm run dev
```

> [!IMPORTANT]
> Si no existe configuración y el proceso tiene una TTY, el arranque abre el
> wizard de bootstrap. Sin TTY, falla de forma explícita para no iniciar un
> servicio sin identidad ni primer administrador.

## Configuración

La configuración no secreta vive normalmente en:

```text
config/runtime.json
```

Los secretos viven en el fichero hermano:

```text
config/.env
```

La ruta puede cambiarse con `GAMECLUB_CONFIG_PATH` y `GAMECLUB_ENV_PATH`.
`startup.sh` despliega ambos archivos a `/etc/gameclubtelegrambot/`; por tanto,
la copia de `/etc` no debe editarse como fuente habitual si el siguiente
despliegue volverá a generarla desde `config/`.

Comandos principales:

```bash
npm run config:init
npm run config:edit
npm run config:check
```

La referencia completa, incluidos defaults, secretos y features opcionales, está
en [`docs/runtime-configuration.md`](docs/runtime-configuration.md).

## Desarrollo y pruebas

```bash
npm run lint
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm test
```

Base de datos:

```bash
npm run db:generate
npm run db:check
npm run db:check:state
npm run db:migrate
```

Herramientas operativas y de análisis:

```bash
npm run admin:console
npm run backup:console
npm run telegram:ux
npm run telegram:ux:tui
npm run codex:image
npm run codex:benchmark
./scripts/service-journal.sh -n 200
```

Después de cualquier cambio funcional se actualiza el inventario, se ejecuta
`./scripts/feature-status-audit.sh` y se cierra la validación con `./startup.sh`.
El procedimiento completo está en
[`docs/development-and-validation.md`](docs/development-and-validation.md).

## Despliegue y operación

Entrada recomendada para construir, migrar, instalar y reiniciar:

```bash
./startup.sh --config-source ./config/runtime.json --operator-user "$USER"
```

Instalación explícita de la pila Debian:

```bash
./scripts/install-debian-stack.sh \
  --app-root /opt/gameclubtelegrambot \
  --config-source ./config/runtime.json \
  --operator-user "$USER"
```

La instalación gestiona la unidad principal, backups programados, wrappers IA,
permisos operativos, bandeja de escritorio y, cuando se activa, el servicio
Telegram Bot API local.

Diagnóstico:

```bash
systemctl is-active gameclubtelegrambot.service
./scripts/service-journal.sh --since "2026-07-30 10:00:00"
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:8787/
```

Backups:

```bash
./scripts/backup-cli.sh status
./scripts/backup-cli.sh backup
./scripts/backup-cli.sh list
./scripts/backup-cli.sh restore /ruta/al/backup.zip
```

Consulta [`docs/debian-service-operations.md`](docs/debian-service-operations.md)
y [`docs/backup-restore-recovery.md`](docs/backup-restore-recovery.md) antes de
operar o restaurar producción.

## Estructura

```text
src/          código TypeScript por dominio
drizzle/      migraciones y snapshots del schema
docs/         documentación mantenida y diseños históricos
scripts/      instalación, diagnóstico, IA, backup y restauración
deploy/       unidades systemd y autostart Debian
config/       configuración runtime local, no secretos versionados
data/         datos runtime no almacenados en PostgreSQL
startup.sh    entrada principal de despliegue
```

## Documentación

El índice completo está en [`docs/README.md`](docs/README.md).

Referencias principales:

- [`Estado real de features`](docs/feature-status.md)
- [`Arquitectura`](docs/architecture.md)
- [`Desarrollo y validación`](docs/development-and-validation.md)
- [`Configuración runtime`](docs/runtime-configuration.md)
- [`Admin HTTP server`](docs/admin-http-server.md)
- [`Interacción LLM`](docs/llm-natural-language.md)
- [`Google Calendar`](docs/google-calendar.md)
- [`Notion para campañas de Rol`](docs/role-game-notion.md)
- [`Generación de imágenes`](docs/image-generation.md)
- [`Operación Debian`](docs/debian-service-operations.md)
- [`Backup y recuperación`](docs/backup-restore-recovery.md)
