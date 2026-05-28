# Agent Notes

## Service Logs

Use `./scripts/service-journal.sh` to inspect the Telegram bot journal. It sets
the correct systemd unit (`gameclubtelegrambot.service`), disables the pager, and
uses `sudo` when needed so the service logs are visible.

Examples:

```bash
./scripts/service-journal.sh
./scripts/service-journal.sh -n 200
./scripts/service-journal.sh --since "2026-05-05 18:35:00" --until "2026-05-05 18:50:00"
./scripts/service-journal.sh --follow
```

Prefer this wrapper over calling `journalctl` directly when debugging runtime
Telegram failures.

## OpenCode / IA desde el bot

Cuando una feature del bot necesite usar IA mediante OpenCode, no ejecutes
`opencode` directamente desde el servicio. Usa siempre el wrapper:

```bash
./scripts/opencode-cawa.sh
```

En despliegue, el servicio apunta a ese wrapper con `GAMECLUB_OPENCODE_BIN`.
El bot corre como `gameclubbot`, pero OpenCode debe ejecutarse como el usuario
operador `cawa`, que es donde estan las credenciales y modelos disponibles. El
instalador mantiene una regla sudoers limitada para permitir solo esa ejecucion.

Para nuevas integraciones, lee `GAMECLUB_OPENCODE_BIN` y llama a ese binario en
lugar de hardcodear `opencode`. Si necesitas enviar el prompt por stdin, usa:

```bash
printf 'prompt\n' | ./scripts/opencode-cawa.sh run --stdin --model openai/gpt-5.4-mini
```

## Local validation workflow

After every code change in this bot, run `./startup.sh` before handing the work
back so the live Telegram bot is rebuilt/restarted and can be tested for real.
Do this even if targeted tests passed, unless the user explicitly asks not to.

Run:

```bash
./startup.sh
```

## Admin HTTP server / panel web

El panel web de apoyo del bot se llama **Admin HTTP server del bot**. No es una
app frontend separada: vive dentro del servicio `gameclubtelegrambot.service` y
esta implementado principalmente en:

- `src/http/admin-http-server.ts`
- `src/http/admin-http-server.test.ts`

El servicio del bot levanta el servidor interno en `127.0.0.1:8787`. En
despliegue publico, Nginx lo expone como reverse proxy en:

- `https://cawa.hopto.org/` pagina de bienvenida publica.
- `https://cawa.hopto.org/feedback` formulario publico de feedback.
- `https://cawa.hopto.org/admin` panel admin protegido por la contraseña de
  elevacion admin (`GAMECLUB_ADMIN_PASSWORD_HASH`).
- `https://cawa.hopto.org/admin/welcome` configuracion admin de mensajes de
  bienvenida de grupo con plantillas `$USERNAME` y GIF opcional por Telegram
  animation file ID.

Los admins tambien pueden gestionar bienvenidas desde Telegram con el boton
`Bienvenidas` del menu privado de Inicio; ese flujo lista plantillas con
paginacion por botones de teclado, un enlace inline compacto junto a cada
plantilla para abrir su detalle, y acciones de detalle para editar texto, editar
GIF/video, previsualizar, activar/pausar y eliminar. Al crear o editar texto,
debe conservar las entidades de formato de Telegram como HTML seguro (negrita,
cursiva, enlaces, etc.). Al crear o editar adjuntos, acepta animaciones
Telegram, videos convertidos por el movil o archivos `.gif`, y guarda su file
ID automaticamente en las plantillas.

El bot tambien tiene aliases privados no anunciados para previsualizar la
bienvenida propia: `Welcome`, `/welcome`, `Bienvenida` y `/bienvenida`.
`/welcome 1` o `/bienvenida 1` fuerzan una plantilla por posicion visible. La
seleccion aleatoria debe usar el Telegram user ID del remitente, el nombre
visible guardado en `users.display_name`, y evitar repetir inmediatamente la
ultima plantilla enviada a ese usuario cuando existan alternativas.

Cuando un admin aprueba una solicitud desde Telegram (`/approve` o el callback
de revisión), no se envía bienvenida privada al usuario aprobado. El bot debe
publicar una plantilla de bienvenida en los grupos con news mode habilitado y
suscritos a `nuevos_miembros`. La entrada normal de alguien a un grupo donde
esta el bot no debe disparar estas bienvenidas.

Nginx gestiona `80/tcp` y `443/tcp`; el backend `8787/tcp` debe permanecer
interno y no abrirse en el router. El certificado HTTPS es de Let's Encrypt y
lo renueva `certbot.timer`.

Cuando modifiques este panel:

- Mantén `/` como bienvenida publica, `/feedback` publico y `/admin` protegido.
- Mantén las acciones admin POST con token CSRF y sesiones firmadas.
- No expongas secretos ni hashes en HTML, logs o respuestas HTTP.
- Actualiza `docs/feature-status.md` si cambia comportamiento visible o
  capacidad operativa.
- Valida al menos con `node --import tsx --test src/http/admin-http-server.test.ts`
  y `npm run typecheck`, y luego ejecuta `./startup.sh`.
- Comprueba despues `https://cawa.hopto.org/` y `https://cawa.hopto.org/admin`.

## Telegram UX style guides

Before adding or changing Telegram pagination, read
`docs/telegram-pagination-style.md`. It documents the repo style for page
indicators, reply-keyboard navigation, inline callback navigation and tests.

Before adding or changing editable progress/receipt messages, read
`docs/telegram-editable-progress.md`.

For public/admin web visual changes, read `docs/brand-guidelines.md`.

## Telegram progress messages

For Telegram actions that can take medium or long time, use an editable progress
message instead of leaving the user waiting after they press a button or confirm
an action.

Expected pattern:

- Send one progress message as soon as the slow action starts.
- Edit that same message as the operation moves through meaningful steps.
- Include concrete step labels, not generic "working" text.
- When the operation finishes, edit the progress message into the final result
  whenever possible.
- If Telegram message editing is unavailable or fails, fall back to sending the
  final message normally.
- Log edit failures as structured warnings, but do not fail the user action only
  because the progress message could not be edited.

Use the existing catalog autocorrect and Storage upload flows as reference
implementations for this UX.

## Índice de features del bot de Telegram

`docs/feature-status.md` es el inventario operativo del bot de Telegram.
Es el documento único de referencia para:

- Qué features están disponibles por módulo.
- Estado de cada feature (`operativo`, `parcial`, `pendiente`, `técnico`).
- Riesgos abiertos, limitaciones y pruebas relacionadas.
- Cobertura por secciones del dominio (agenda, catálogo, storage, compras, etc.).

Debe actualizarse **siempre** que se añada, modifique o elimine una feature visible o técnica del bot de Telegram, incluso si el cambio solo afecta texto, permisos o onboarding.

Al terminar cualquier cambio funcional, ejecuta:

```bash
./scripts/feature-status-audit.sh
```

El comando muestra el estado del inventario y recuerda los bloques mínimos que deben revisarse
antes de validar cambios productivos.

before testing behavior in Telegram.

## Fuente única del estado de features

El único archivo que se mantiene manualmente es:

- `docs/feature-status.md` (en este repositorio).

La ruta en `/opt/gameclubtelegrambot/docs/feature-status.md` se considera una copia de despliegue y no se edita manualmente.
Cuando corresponda actualizarla, vuelve a ejecutar `./startup.sh` para que se regenere desde `docs/feature-status.md`.

## Formato obligatorio del inventario de features

El bloque `Resumen ejecutivo` de `docs/feature-status.md` debe mantenerse en formato de tabla de texto ancho fijo, dentro de un bloque de código Markdown:

```text
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
| Feature                                      | Estado               | Lectura actual                                                                                                                       |
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
...
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
```

No mezclar este bloque con tabla Markdown simple (`| ... | ... |`), porque la intención es tener lectura humana consistente y columnas visualmente alineadas.
