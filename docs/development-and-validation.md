# Desarrollo y validación

## Requisitos

- Node.js 20.19 o posterior.
- npm.
- PostgreSQL.
- Docker y Docker Compose para el entorno local preparado automáticamente.
- Dependencias externas opcionales según la feature: Python para la consola
  Textual, CUPS/LibreOffice/ImageMagick para impresión y Codex para funciones IA.

## Preparación local

```bash
npm install
npm run init:local
npm run start:local
```

`init:local` levanta PostgreSQL en `127.0.0.1:55432`, genera
`config/runtime.local.json`, prepara secretos locales y aplica migraciones.

Para desarrollo con recarga:

```bash
npm run dev
```

## Comandos de calidad

| Comando | Qué valida |
| --- | --- |
| `npm run lint` | Convenciones y salud del repositorio |
| `npm run typecheck` | Tipos TypeScript sin emitir build |
| `npm run build` | Compilación de producción y versión de build |
| `npm run test:unit` | Tests unitarios con el runner de Node |
| `npm run test:integration` | Tests que requieren el entorno de integración |
| `npm test` | Unitarios e integración |
| `npm run db:check` | Coherencia de migraciones generadas |
| `npm run db:check:state` | Estado interno de Drizzle |
| `npm run docs:check` | Índice, enlaces locales, scripts y referencias de tests documentadas |
| `./scripts/feature-status-audit.sh` | Checklist del inventario documental |

Los tests están junto al código como `*.test.ts`; los de integración usan
`*.integration.test.ts`.

## Cambios de base de datos

El schema canónico está en `src/infrastructure/database/schema.ts`.

```bash
npm run db:generate
npm run db:check
npm run db:migrate
```

Toda modificación de schema debe incluir la migración y el snapshot generados.
No se debe editar una migración ya aplicada para introducir un cambio nuevo.

## Validación según el área

Antes de editar, lee la guía obligatoria correspondiente:

- paginación Telegram: `docs/telegram-pagination-style.md`;
- progreso editable: `docs/telegram-editable-progress.md`;
- lenguaje natural o IA conversacional: `docs/llm-natural-language.md`;
- web pública o panel admin: `docs/brand-guidelines.md`;
- configuración o despliegue: `docs/runtime-configuration.md` y
  `docs/debian-service-operations.md`.

Después de un cambio:

1. Ejecuta los tests específicos del módulo modificado.
2. Ejecuta `npm run typecheck`.
3. Si cambia el schema, ejecuta `npm run db:check`.
4. Actualiza `docs/feature-status.md` y cualquier guía especializada afectada.
5. Ejecuta `./scripts/feature-status-audit.sh`.
6. Ejecuta `npm run docs:check`.
7. Ejecuta `git diff --check`.
8. Ejecuta `./startup.sh`, incluso si los tests específicos pasaron.
9. Comprueba el servicio y la superficie realmente modificada.

Para cambios del Admin HTTP server, la validación mínima adicional es:

```bash
node --import tsx --test src/http/admin-http-server.test.ts
curl --fail --silent --show-error --output /dev/null https://cawa.hopto.org/
curl --fail --silent --show-error --output /dev/null https://cawa.hopto.org/admin
```

No se debe afirmar que una integración externa funciona en vivo si sólo se ha
validado con dobles de test. La prueba local, el despliegue y la verificación
credencial o física pendiente deben comunicarse por separado.

## Diagnóstico del servicio

Usa el wrapper del repositorio para leer el journal:

```bash
./scripts/service-journal.sh -n 200
./scripts/service-journal.sh --since "2026-07-30 10:00:00"
./scripts/service-journal.sh --follow
```

Para comprobar el estado:

```bash
systemctl is-active gameclubtelegrambot.service
```

## IA desde el servicio

Las integraciones nuevas deben leer los binarios configurados:

- `GAMECLUB_CODEX_BIN`, normalmente `./scripts/codex-cawa.sh`;
- `GAMECLUB_OPENCODE_BIN`, normalmente `./scripts/opencode-cawa.sh`.

El servicio corre como `gameclubbot`, mientras que los wrappers ejecutan las
herramientas con el usuario operador que posee las credenciales. No se debe
invocar `codex` u `opencode` directamente desde el proceso del bot.
