# Desarrollo y validación

## Requisitos

- Node.js 24 LTS o posterior (usar una rama con soporte).
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
| `npm test` / `npm run test:affected` | Pruebas afectadas por los cambios de Git, incluidas las de integración seleccionadas |
| `npm run test:categories` | Categorías disponibles y número de archivos de prueba |
| `npm run test:all` | Suite completa, solicitada explícitamente |
| `npm run db:check` | Coherencia de migraciones generadas |
| `npm run db:check:state` | Estado interno de Drizzle |
| `npm run docs:check` | Índice, enlaces locales, scripts y referencias de tests documentadas |
| `./scripts/feature-status-audit.sh` | Checklist del inventario documental |

Los tests están junto al código como `*.test.ts`; los de integración usan
`*.integration.test.ts`.

## Selección de pruebas por impacto

El comando habitual es `npm test`. Compara el árbol de trabajo con `HEAD`,
incluyendo cambios staged, unstaged, eliminaciones y archivos nuevos no ignorados.
Selecciona las pruebas de las categorías modificadas y las de consumidores
transitivos mediante imports, reexportaciones e imports dinámicos literales.
Los archivos de prueba modificados se incluyen directamente. No se mueven los
tests: siguen junto al código; la separación por categorías es lógica.

```bash
npm test
npm test -- --dry-run
npm test -- --since main
npm test -- --unit
npm run test:categories
npm test -- --category storage
npm test -- --category agenda,google-calendar
npm test -- --file src/printing/page-selection.ts --dry-run
npm run test:all
```

`--since` compara contra la referencia Git indicada y es necesario para revisar
cambios ya confirmados: con un árbol limpio, la comparación con `HEAD` no tiene
pruebas afectadas. Una referencia inválida hace fallar el comando.
`--file` sustituye la detección Git por una ruta concreta (se puede repetir).
`--category` selecciona exclusivamente las categorías solicitadas, por lo que
para comprobar el impacto automático completo se utiliza `npm test`.
`--unit` y `--integration` filtran por tipo; sin filtro se incluyen ambos.
Los tests PostgreSQL conservan su configuración y comportamiento de omisión
cuando no hay entorno de integración; una omisión no demuestra su validación.

Categorías: `access`, `agenda`, `ai`, `catalog`, `equipment`, `feedback`,
`google-calendar`, `images`, `lfg`, `loans`, `news`, `notices`, `operations`,
`printing`, `purchases`, `role`, `runtime`, `storage`, `tables`, `testing`,
`venue-events` y `web`. La clasificación y el grafo viven en
[`selection.ts`](../src/scripts/testing/selection.ts).

Cambios en dependencias, tsconfig, schema/migraciones, CI o el selector requieren
la suite completa del tipo seleccionado. Un archivo sin regla de impacto también
amplía la selección a todas las pruebas. Los cambios exclusivamente Markdown/docs
no lanzan tests de código: se validan con `npm run docs:check` y `git diff --check`.

El grafo no detecta lecturas arbitrarias de archivos, imports calculados ni
dependencias externas. Las reglas complementarias cubren schemas JSON de los
dominios, scripts operativos y wrappers IA/Bot API local; al introducir otra
dependencia de ese tipo se debe actualizar el selector. Los módulos compartidos
pueden seleccionar varias categorías, aunque sólo se cambie un archivo.

CI aplica el selector a unitarios e integración contra el SHA base del PR o el
commit anterior del push. Si no existe una base válida, ejecuta la suite completa.
Typecheck, build y los checks generales mantienen su ejecución normal.

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

1. Ejecuta `npm test` para los tests afectados; añade los checks específicos obligatorios del módulo. No ejecutes la suite completa por defecto.
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

## Runtime de despliegue

Instala Node.js 24 LTS antes de ejecutar `startup.sh` o el instalador en un host
nuevo. `scripts/resolve-node-bin.sh` selecciona `GAMECLUB_NODE_BIN`, el runtime
dedicado `/opt/gameclubtelegrambot-node/bin/node` si existe o el `node` del PATH,
y rechaza versiones inferiores a 24. El instalador usa ese binario para validar
configuración, migraciones, systemd y tray, y su directorio para npm. No sustituye
el Node de paquetes de Debian ni descarga automáticamente un runtime.
