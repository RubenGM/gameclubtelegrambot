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

When making a code change that must be validated in the running bot, always run:

```bash
./startup.sh
```

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
