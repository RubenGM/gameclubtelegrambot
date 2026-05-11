# Debian Service Operations

Aquest document descriu com desplegar i operar `gameclubtelegrambot` com a servei de sistema a Debian.

## Objectiu

Aquest paquet de desplegament prepara tres peces:

- una unitat `systemd` per executar el bot de forma persistent
- una regla `polkit` limitada al servei del bot
- convencions d'entorn perquè futures eines d'operació, com la safata Debian, el puguin controlar amb seguretat

## Instal·lació ràpida de tota la pila

L'entrypoint operatiu recomanat per al dia a dia és:

```bash
./startup.sh --config-source ./config/runtime.json --operator-user "$USER"
```

Aquest script orquestra el flux complet: prerequisits, desplegament/actualització, dependències locals si s'escauen, safata Debian i arrencada o reinici del servei.

La nova acció `Rebuild and restart` de la safata Debian reutilitza aquest mateix entrypoint amb `--no-tray --skip-apt` per aplicar una reconstrucció i reinici des del menú de safata.

Internament reutilitza `./scripts/install-debian-stack.sh` per a la preparació del sistema.

Si es vol executar només la fase d'instal·lació base sense la seqüència final de tray + reinici, es pot seguir fent servir directament:

Per preparar en una sola passada aplicació, servei, permisos i safata a Debian:

```bash
./scripts/install-debian-stack.sh --app-root /opt/gameclubtelegrambot --config-source ./config/runtime.json --operator-user "$USER"
```

Aquest script:

- instal·la els paquets del sistema necessaris
- construeix `dist/` localment abans del desplegament
- crea usuaris i grups operatius
- copia l'aplicació al directori objectiu
- instal·la dependències de producció
- copia la configuració runtime a `/etc/gameclubtelegrambot/runtime.json`
- copia els secrets runtime a `/etc/gameclubtelegrambot/.env` si existeixen
- crea `/etc/default/gameclubtelegrambot`
- valida la configuració runtime instal·lada
- aplica les migracions pendents abans d'arrencar el servei
- instal·la `systemd`, `polkit` i autostart de la safata
- arrenca el servei si no s'indica `--no-start`

La safata que instal·la aquest procés és l'app de system tray Debian documentada a `docs/debian-tray-operations.md`, no un dashboard web separat.

## Convencions operatives

La proposta actual assumeix aquestes rutes i identitats:

- directori d'aplicació: `/opt/gameclubtelegrambot`
- usuari del servei: `gameclubbot`
- grup del servei: `gameclubbot`
- grup d'operadors amb permís de control: `gameclubbot-operators`
- unitat de sistema: `gameclubtelegrambot.service`
- fitxer d'entorn: `/etc/default/gameclubtelegrambot`
- fitxer secrets runtime: `/etc/gameclubtelegrambot/.env`

El servei assumeix que l'aplicació ja està construïda i que existeix:

- `dist/main.js`
- `dist/scripts/check-runtime-config.js`
- `dist/scripts/migrate.js`
- `node_modules/`

## Expectatives de runtime

La unitat `systemd` no executa bootstrap interactiu.

Per tant, abans d'habilitar el servei cal tenir:

- una configuració runtime vàlida
- una base de dades ja inicialitzada
- migracions aplicades
- un token de Telegram vàlid

La unitat falla de forma explícita si no troba:

- `/etc/gameclubtelegrambot/runtime.json`
- `/opt/gameclubtelegrambot/dist/main.js`

Si es vol fer servir una ruta de configuració no estàndard, cal definir-la al fitxer d'entorn:

```bash
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json
GAMECLUB_ENV_PATH=/etc/gameclubtelegrambot/.env
NODE_ENV=production
```

## Instal·lació dels usuaris i grups

Crear l'usuari i els grups del servei:

```bash
sudo adduser --system --group --home /opt/gameclubtelegrambot gameclubbot
sudo groupadd --force gameclubbot-operators
```

Afegir els operadors humans al grup de control:

```bash
sudo usermod -aG gameclubbot-operators <nom-usuari>
```

## Instal·lació de l'aplicació

Copiar o desplegar el projecte a `/opt/gameclubtelegrambot` i assegurar propietat correcta:

```bash
sudo install -d -o gameclubbot -g gameclubbot /opt/gameclubtelegrambot
sudo chown -R gameclubbot:gameclubbot /opt/gameclubtelegrambot
```

Després cal construir l'aplicació i deixar `dist/` disponible.

En desplegament manual, la seqüència mínima recomanada és:

```bash
npm ci
npm run build
```

## Fitxer d'entorn

Crear `/etc/default/gameclubtelegrambot` si cal personalitzar l'entorn:

```bash
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json
GAMECLUB_ENV_PATH=/etc/gameclubtelegrambot/.env
NODE_ENV=production
```

El fitxer és opcional perquè la unitat fa servir `EnvironmentFile=-...`, però és la manera recomanada de fixar la configuració de producció.

## Validació del runtime abans d'arrencar

Abans d'habilitar el servei és recomanable validar explícitament la configuració i aplicar migracions:

```bash
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/check-runtime-config.js
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/migrate.js
```

L'script `install-debian-stack.sh` ja fa aquests dos passos abans de fer `systemctl enable --now`.

## Instal·lació de la unitat systemd

Copiar la unitat al sistema:

```bash
sudo install -m 0644 deploy/systemd/gameclubtelegrambot.service /etc/systemd/system/gameclubtelegrambot.service
sudo systemctl daemon-reload
```

Habilitar i arrencar el servei:

```bash
sudo systemctl enable --now gameclubtelegrambot.service
```

## Desinstal·lació de servei i autoarrencada

Per retirar les peces que fan que el bot arrenqui al sistema:

```bash
./scripts/uninstall-debian-stack.sh --operator-user "$USER"
```

Aquest script atura i deshabilita `gameclubtelegrambot.service`, elimina la unitat instal·lada a `/etc/systemd/system/`, elimina la regla `polkit` del projecte i elimina l'autostart de safata de l'usuari operador.

Abans d'executar canvis reals es pot revisar la seqüència:

```bash
./scripts/uninstall-debian-stack.sh --dry-run --operator-user "$USER"
```

No elimina `/opt/gameclubtelegrambot`, `/etc/gameclubtelegrambot`, bases de dades, paquets del sistema, usuaris ni grups.

Comandes bàsiques d'operació:

```bash
sudo systemctl status gameclubtelegrambot.service
sudo systemctl restart gameclubtelegrambot.service
sudo systemctl stop gameclubtelegrambot.service
sudo systemctl start gameclubtelegrambot.service
```

## Recuperar comandos de Telegram que no responden

Si el bot recibe mensajes pero algunas acciones no generan respuesta, comprobar primero si
hay procesos duplicados o validaciones colgadas:

```bash
pgrep -af "gameclubtelegrambot|node --import tsx --test|npm run typecheck|tsc --noEmit|tsx|dist/main.js" || true
systemctl status gameclubtelegrambot.service --no-pager
./scripts/service-journal.sh -n 120
```

El estado correcto en producción es un único proceso del servicio:

```text
/usr/bin/node /opt/gameclubtelegrambot/dist/main.js
```

La safata Debian puede tener procesos propios (`debian-tray.js` y
`debian-tray-host.py`), pero no debe existir otro `dist/main.js` ni procesos de
test/build activos. Si quedan procesos de validación (`node --test`, `tsc`,
`npm run typecheck`), esperar a que terminen o pararlos antes de seguir.

Si el journal muestra `Telegram update received` pero no aparece respuesta ni error,
revisar si hay sesiones conversacionales atascadas en `app_metadata`:

```bash
PGPASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env.postgres.local)" \
psql -h 127.0.0.1 -p 55432 -U gameclub_user -d gameclub \
  -c "select key, value::jsonb->>'flowKey' as flow, value::jsonb->>'stepKey' as step, value::jsonb->>'updatedAt' as updated_at, value::jsonb->>'expiresAt' as expires_at from app_metadata where key like 'telegram.session:%' order by updated_at desc;"
```

Las sesiones caducadas se pueden borrar sin perder datos de dominio:

```bash
PGPASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env.postgres.local)" \
psql -h 127.0.0.1 -p 55432 -U gameclub_user -d gameclub \
  -c "delete from app_metadata where key like 'telegram.session:%' and (value::jsonb->>'expiresAt')::timestamptz <= now() returning key;"
```

Si el bot sigue recibiendo updates pero no responde, reiniciar el servicio para limpiar
estado en memoria y reabrir el long polling:

```bash
systemctl restart gameclubtelegrambot.service
./scripts/service-journal.sh -n 50
```

Desde Telegram, un admin tambien puede ejecutar `/restart` en privado. Ese comando
borra las sesiones conversacionales `telegram.session:%`, limpia estado temporal en
memoria y fuerza una salida con fallo controlado para que systemd levante un proceso
nuevo mediante `Restart=on-failure`. Si el bot no llega a procesar ningun comando,
usar el reinicio por `systemctl` desde la maquina.

El runtime mantiene un canario interno de Telegram API. Si una llamada a Telegram
falla de forma transitoria (`timeout`, red, 429 o 5xx), los mensajes de texto normales
añaden temporalmente un aviso indicando desde cuando se detecto la incidencia y
recomendando reintentar mas tarde si el bot deja de responder. El aviso se retira
automaticamente tras varios envios correctos y una ventana sin nuevos fallos.

Cuando el bloqueo aparece durante autocorrecciones de catálogo, revisar en el journal
las duraciones de `catalog.external-image.telegram-upload.completed` y de traducción.
Es normal que una subida de portada externa tarde decenas de segundos; durante ese
periodo las respuestas pueden acumularse si la acción en curso está ocupando el flujo
del usuario.

## Instal·lació de la regla polkit

Copiar la regla:

```bash
sudo install -d /etc/polkit-1/rules.d
sudo install -m 0644 deploy/polkit/rules.d/50-gameclubtelegrambot.rules /etc/polkit-1/rules.d/50-gameclubtelegrambot.rules
```

La regla permet només `start`, `stop` i `restart` sobre `gameclubtelegrambot.service` per a usuaris del grup `gameclubbot-operators`.

No dona permís per gestionar serveis arbitraris.

## Validació manual

Comprovar l'estat del servei:

```bash
systemctl show gameclubtelegrambot.service --property=ActiveState --value
```

Comprovar que un operador autoritzat pot reiniciar-lo sense `sudo`:

```bash
systemctl restart gameclubtelegrambot.service
```

Comprovar logs recents:

```bash
journalctl -u gameclubtelegrambot.service -n 50 --no-pager
```

Comprovar denegació de permisos en un usuari fora del grup operador.

## Relació amb la safata Debian

La futura safata Debian assumirà exactament aquesta convenció:

- nom de servei `gameclubtelegrambot.service`
- control via `systemctl`
- logs via `journalctl`
- permisos delegats a `polkit`

Si aquestes convencions canvien, també caldrà actualitzar la capa `service-control` i la futura UI de safata.

## Backup i recuperació

El runbook específic de backup, restore i recuperació és a:

- `docs/backup-restore-recovery.md`
