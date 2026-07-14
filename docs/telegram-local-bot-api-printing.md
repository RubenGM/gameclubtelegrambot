# Bot API local para impresión

La impresión puede usar un servidor local de Telegram Bot API sólo para descargar
archivos grandes. El resto del bot sigue usando el Bot API público de Telegram
para recibir updates, responder mensajes, publicar en grupos, gestionar Storage,
Avisos, catálogo, agenda y demás flujos.

## Por qué existe

El Bot API público limita `getFile` a descargas de 20 MB. Ese límite es
demasiado bajo para PDFs de rol, manuales y fichas grandes. Telegram permite
ejecutar un servidor Bot API local; en ese modo `getFile` puede devolver una ruta
local absoluta y no hace falta descargar el archivo desde `api.telegram.org`.

En este bot la integración se mantiene aislada:

- Sólo el flujo de impresión llama a `downloadFile` con `allowLocalBotApi: true`.
- Si `telegram.localBotApi.enabled` no está activo, el comportamiento sigue igual
  que antes y los archivos de más de 20 MB se rechazan con explicación.
- Si el servidor local falla, el bot registra el fallo y cae al método cloud
  normal. Esto conserva compatibilidad para archivos pequeños.
- Ningún otro flujo queda obligado a depender del servidor local.

## Configuración runtime

Guía operativa paso a paso:
`docs/telegram-local-bot-api-configuration.md`.

Ejemplo:

```json
{
  "telegram": {
    "token": "se-guarda-en-env-en-produccion",
    "localBotApi": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8081",
      "dataDir": "/var/lib/gameclubtelegrambot/telegram-bot-api"
    }
  }
}
```

Credenciales en `.env`:

```env
GAMECLUB_TELEGRAM_LOCAL_BOT_API_ID="123456"
GAMECLUB_TELEGRAM_LOCAL_BOT_API_HASH="hash-de-my-telegram-org"
```

Recomendaciones:

- Mantener `baseUrl` en `127.0.0.1`.
- No exponer el servidor local por Nginx, router, VPN ni LAN.
- No activar `enabled` hasta que el servicio local esté instalado y responda.
- Dejar el token como secreto en `.env`; no duplicarlo en documentación ni logs.

## Operación esperada

Cuando un usuario imprime un adjunto o un archivo de Storage:

1. `print-flow` pide la descarga con `allowLocalBotApi: true`.
2. El runtime comprueba si `telegram.localBotApi.enabled` está activo.
3. Si está activo, llama a `{baseUrl}/bot<TOKEN>/getFile`.
4. Si `file_path` es una ruta absoluta, copia el archivo local al temporal de
   impresión.
5. Si `file_path` es relativo, descarga desde `{baseUrl}/file/bot<TOKEN>/...`.
6. Si el intento local falla, registra el error sin token y usa la descarga cloud
   normal como fallback.

El límite de 20 MB sólo se aplica cuando el runtime no anuncia soporte de
descargas grandes. Con Bot API local activo, impresión intenta preparar también
archivos superiores a 20 MB.

## Servicio local instalado con el bot

El despliegue instala una unidad systemd hermana:

- Servicio principal: `gameclubtelegrambot.service`.
- Servicio local: `gameclubtelegrambot-local-bot-api.service`.
- EnvironmentFile operativo: `/etc/default/gameclubtelegrambot-local-bot-api`.
- Credenciales: `/etc/gameclubtelegrambot/.env`.
- Datos: `telegram.localBotApi.dataDir`, por defecto
  `/var/lib/gameclubtelegrambot/telegram-bot-api`.

`./scripts/install-debian-stack.sh` siempre instala la unidad local y su
EnvironmentFile. `./startup.sh` decide el estado real:

- Si `telegram.localBotApi.enabled` es `false`, la unidad local queda aturada y
  deshabilitada.
- Si `telegram.localBotApi.enabled` es `true`, `startup.sh` reinicia primero
  `gameclubtelegrambot-local-bot-api.service` y luego
  `gameclubtelegrambot.service`.
- El servicio principal se genera con `Wants=` y `After=` hacia la unidad local
  sólo cuando está activada.
- La unidad local usa el mismo usuario/grupo `gameclubbot`, por lo que impresión
  puede copiar rutas absolutas devueltas por `getFile` sin abrir permisos extra.

El binario `telegram-bot-api` debe existir en el sistema. Si se activa la
feature y el instalador no encuentra un ejecutable en `PATH` o en
`GAMECLUB_TELEGRAM_LOCAL_BOT_API_BIN`, compila e instala el servidor oficial de
TDLib desde `https://github.com/tdlib/telegram-bot-api` mediante
`scripts/install-telegram-bot-api.sh`. Si se ejecuta con `--skip-apt`, no instala
dependencias de compilación y falla con un mensaje explícito en lugar de
arrancar a medias.

Checklist de activación:

1. Obtener `api_id` y `api_hash` en `https://my.telegram.org`.
2. Configurar `telegram.localBotApi.enabled=true`.
3. Añadir `GAMECLUB_TELEGRAM_LOCAL_BOT_API_ID` y
   `GAMECLUB_TELEGRAM_LOCAL_BOT_API_HASH` al `.env`.
4. Reiniciar con `./startup.sh`.
5. Probar un PDF pequeño en `Modo prueba`.
6. Probar un PDF de más de 20 MB en `Modo prueba`.
7. Revisar `./scripts/service-journal.sh -n 200` si hay fallback al cloud.

Si el binario no existe todavía, el primer `./startup.sh` con
`telegram.localBotApi.enabled=true` puede tardar varios minutos porque compila
TDLib y `telegram-bot-api` desde fuente.

## Ampliación futura

Si más adelante se quiere usar el Bot API local para otros módulos, no cambies
directamente todo `runtime.bot.downloadFile`. Añade una intención explícita al
sitio de llamada, igual que impresión usa `allowLocalBotApi: true`, y documenta:

- Qué flujo lo necesita.
- Qué tamaño o caso de uso desbloquea.
- Qué fallback debe existir si el servidor local no está disponible.
- Qué pruebas cubren que los demás flujos no cambian de comportamiento.
