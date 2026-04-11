# Game Club Telegram Bot

Servicio de Telegram para gestionar un club de juegos con PostgreSQL, Drizzle y despliegue en Debian.

## Resumen

El proyecto ya funciona como servicio Node.js + TypeScript con:

- PostgreSQL real y migraciones con Drizzle ORM
- validación de runtime con `zod`
- integración con Telegram mediante `grammY` y `long polling`
- bootstrap interactivo de primer arranque
- menú dinámico por rol, contexto de chat y sesión activa
- control Debian con `systemd` y bandeja de escritorio

> [!NOTE]
> Si no existe `config/runtime.json` y el proceso corre en una TTY interactiva, el arranque entra automáticamente en el wizard de bootstrap. Sin TTY, el arranque falla con un error claro.

> [!NOTE]
> Los secretos runtime viven en `config/.env` por defecto y el proceso los carga en tiempo de ejecución.

## Funcionalidad actual

- acceso cerrado con usuarios aprobados y elevación de administradores
- agenda de actividades con participantes, mesa opcional y avisos de conflicto
- gestión de mesas del club
- catálogo de juegos, libros, expansiones y material asociado
- altas manuales y asistidas desde Telegram
- préstamos y devoluciones de elementos del catálogo
- eventos del local que afectan a la ocupación
- grupos de noticias con suscripciones por categoría
- soporte de idioma `ca`, `es` y `en`

## Importación de catálogo

La carga asistida de catálogo usa fuentes distintas según el tipo de item:

- juegos de mesa: Wikipedia
- libros y libros de rol: Open Library

El catálogo local sigue siendo la fuente de verdad final y siempre se puede editar a mano.

## Requisitos

- `Node.js >= 20.19.0`
- `npm`
- `PostgreSQL`
- `Docker` y `Docker Compose` para la preparación local rápida

## Puesta en marcha local

```bash
npm install
npm run init:local
npm run start:local
```

`npm run init:local` deja preparado:

- PostgreSQL local en Docker en `127.0.0.1:55432`
- `config/runtime.local.json`
- migraciones aplicadas

> [!TIP]
> Si ya tienes `GAMECLUB_TELEGRAM_TOKEN`, puedes exportarlo antes de ejecutar `npm run init:local` para evitar editar `config/.env` a mano.

Para editar configuración y secretos desde terminal:

- `npm run config:edit`
- `npm run config:init`

## Comandos útiles

```bash
npm run dev
npm test
npm run typecheck
npm run build
npm run start
npm run bootstrap:wizard
npm run config:check
npm run db:generate
npm run db:check
npm run db:migrate
```

Otros comandos de entorno local:

- `npm run db:up`
- `npm run db:down`
- `npm run db:logs`
- `npm run db:migrate:local`
- `npm run config:check:local`
- `npm run catalog:wikipedia:boardgame`

## Configuración runtime

Ruta por defecto:

- `config/runtime.json`

Se puede sobreescribir con:

- `GAMECLUB_CONFIG_PATH`

Campos principales:

- `schemaVersion`
- `bot.publicName`
- `bot.clubName`
- `bot.language` (`ca`, `es`, `en`)
- `bot.iconPath` opcional
- `telegram.token`
- `database.host`, `database.port`, `database.name`, `database.user`, `database.password`, `database.ssl`
- `adminElevation.passwordHash`
- `bootstrap.firstAdmin.telegramUserId`
- `bootstrap.firstAdmin.username` opcional
- `bootstrap.firstAdmin.displayName`
- `notifications.defaults.*`
- `featureFlags`

> [!NOTE]
> La contraseña de elevación administrativa no se guarda en claro. El bootstrap la transforma en `adminElevation.passwordHash`.

La referencia completa está en `docs/runtime-configuration.md` y el ejemplo en `config/runtime.example.json`.

## Arranque y operación en Debian

Entrada central recomendada:

```bash
./startup.sh --config-source ./config/runtime.json --operator-user "$USER"
```

Ese flujo prepara o actualiza la instalación, puede levantar PostgreSQL local si procede, abre la bandeja de escritorio y arranca o reinicia el servicio.

Instalación completa de producción:

```bash
./scripts/install-debian-stack.sh --app-root /opt/gameclubtelegrambot --config-source ./config/runtime.json --operator-user "$USER"
```

Safata de escritorio:

```bash
./scripts/enable-debian-tray.sh --install-autostart --app-root /opt/gameclubtelegrambot
```

Control del tray compilado:

```bash
npm run tray:debian
```

## Estructura

- `src/` código fuente TypeScript
- `docs/` guías operativas y de despliegue
- `deploy/` unidad `systemd`, reglas `polkit` y autostart
- `scripts/` utilidades de instalación, backup y restauración
- `startup.sh` entrypoint operativo principal en Debian

## Documentación relacionada

- `docs/bootstrap-wizard.md`
- `docs/runtime-configuration.md`
- `docs/debian-service-operations.md`
- `docs/debian-tray-operations.md`
- `docs/backup-restore-recovery.md`
