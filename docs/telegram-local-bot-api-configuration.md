# Configuración del Bot API local para impresión

Este documento explica cómo activar el servidor local de Telegram Bot API para
que el bot pueda imprimir adjuntos grandes, como PDFs de 72 MB, sin el límite
cloud de 20 MB.

La integración se usa de forma explícita en impresión y al descargar imágenes
de referencia para la generación de imágenes. El resto del bot sigue usando el
Bot API público de Telegram.

## Estado esperado

Con la feature apagada:

```bash
systemctl is-active gameclubtelegrambot.service
systemctl is-enabled gameclubtelegrambot-local-bot-api.service
systemctl is-active gameclubtelegrambot-local-bot-api.service
```

Resultado esperado:

```text
active
disabled
inactive
```

Con la feature activada:

```text
active
enabled
active
```

## Credenciales necesarias

Necesitas una aplicación de Telegram para obtener:

- `api_id`
- `api_hash`

Se obtienen en `https://my.telegram.org` con una cuenta de Telegram. No son el
token del bot de BotFather.

Guárdalos en el fichero fuente de secretos del despliegue:

```bash
${EDITOR:-nano} config/.env
```

Añade estas líneas, sustituyendo los valores:

```env
GAMECLUB_TELEGRAM_LOCAL_BOT_API_ID="123456"
GAMECLUB_TELEGRAM_LOCAL_BOT_API_HASH="api_hash_real"
```

No guardes estas credenciales en `runtime.json`, commits, issues ni mensajes de
Telegram. `/etc/gameclubtelegrambot/.env` es la copia desplegada: no la uses
como fuente manual porque `./startup.sh` la regenera desde `config/.env`.

## Activar runtime

Edita el runtime fuente:

```bash
${EDITOR:-nano} config/runtime.json
```

Dentro de `telegram`, añade o ajusta:

```json
{
  "localBotApi": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:8081",
    "dataDir": "/var/lib/gameclubtelegrambot/telegram-bot-api"
  }
}
```

El `baseUrl` debe quedarse en loopback (`127.0.0.1` o `localhost`). No lo
publiques por Nginx, LAN, VPN ni router.

También puedes usar `npm run config:edit`. El fichero
`/etc/gameclubtelegrambot/runtime.json` es una copia de despliegue y no se edita
manualmente.

## Instalar y arrancar

Ejecuta:

```bash
./startup.sh
```

Si falta `telegram-bot-api`, el instalador compila el servidor oficial de TDLib
desde `https://github.com/tdlib/telegram-bot-api` con
`scripts/install-telegram-bot-api.sh` y lo instala en `/usr/local/bin`. Ese
primer arranque puede tardar varios minutos.

Después de `startup.sh`, comprueba:

```bash
command -v telegram-bot-api
systemctl is-active gameclubtelegrambot.service
systemctl is-enabled gameclubtelegrambot-local-bot-api.service
systemctl is-active gameclubtelegrambot-local-bot-api.service
curl -fsS http://127.0.0.1:8787/ >/dev/null && echo "admin-http-ok"
```

Resultado esperado:

```text
/usr/local/bin/telegram-bot-api
active
enabled
active
admin-http-ok
```

## Prueba sin gastar papel

1. En Telegram, como admin, entra en `Admin` -> `Impresora`.
2. Activa `Modo prueba`.
3. Envía un PDF pequeño y completa el flujo.
4. Envía el PDF grande que antes fallaba por 20 MB.
5. Confirma que el bot llega al resumen de impresión y responde que el trabajo
   se ha preparado en modo prueba.
6. Si la generación de imágenes está habilitada, añade una imagen de referencia
   y comprueba que el flujo la acepta.

Revisa logs si algo no cuadra:

```bash
./scripts/service-journal.sh -n 200
```

Busca entradas relacionadas con:

- `gameclubtelegrambot-local-bot-api.service`
- `Local Telegram Bot API file download failed`
- `Telegram bot long polling started`
- `Admin HTTP server started`

## Desactivar

Para volver al comportamiento anterior:

1. Cambia `telegram.localBotApi.enabled` a `false` en
   `config/runtime.json`.
2. Ejecuta `./startup.sh`.

El startup dejará `gameclubtelegrambot-local-bot-api.service` parado y
deshabilitado. Los archivos pequeños seguirán imprimiéndose por la ruta cloud
normal.

## Archivos que no se versionan

`.gitignore` ignora los secretos runtime habituales y los artefactos locales del
Bot API:

- `config/.env`
- `config/runtime.json`
- `config/runtime.local.json`
- `config/telegram-local-bot-api.env`
- `.telegram-bot-api/`
- `telegram-bot-api-data/`
- `telegram-bot-api-tmp/`
- `gameclubtelegrambot-telegram-bot-api-src/`
- `gameclubtelegrambot-telegram-bot-api-build/`
- `*.tdbinlog`
- `*.tdlog`
- `*.pem`
- `*.key`

En despliegue real, los datos del servidor local viven fuera del repo:

```text
/var/lib/gameclubtelegrambot/telegram-bot-api
```

Y las credenciales viven fuera del repo:

```text
/etc/gameclubtelegrambot/.env
```
