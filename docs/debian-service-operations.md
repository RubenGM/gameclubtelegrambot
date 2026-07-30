# Debian Service Operations

Aquest document descriu com desplegar i operar `gameclubtelegrambot` com a servei de sistema a Debian.

## Objectiu

Aquest paquet de desplegament prepara i manté aquestes peces:

- la unitat principal `gameclubtelegrambot.service`
- la unitat opcional `gameclubtelegrambot-local-bot-api.service`
- la unitat `gameclubtelegrambot-backup.service` i el timer nocturn
  `gameclubtelegrambot-backup.timer`
- una regla `polkit` limitada al servei del bot
- dues regles `sudoers` limitades als binaris OpenCode i Codex de l'operador
- l'autostart i les convencions d'entorn de la safata Debian
- els fitxers runtime instal·lats sota `/etc/gameclubtelegrambot`

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
- instal·la la unitat principal, el servei Bot API local opcional, el servei i
  timer de backup, `polkit` i l'autostart de la safata
- valida amb `visudo` i instal·la les regles limitades per executar OpenCode i
  Codex com l'usuari operador
- habilita `gameclubtelegrambot-backup.timer`
- activa o desactiva el Bot API local d'acord amb el runtime
- arrenca el servei si no s'indica `--no-start`

La safata que instal·la aquest procés és l'app de system tray Debian documentada a `docs/debian-tray-operations.md`, no un dashboard web separat.

## Convencions operatives

La proposta actual assumeix aquestes rutes i identitats:

- directori d'aplicació: `/opt/gameclubtelegrambot`
- usuari del servei: `gameclubbot`
- grup del servei: `gameclubbot`
- grup d'operadors amb permís de control: `gameclubbot-operators`
- unitat principal: `gameclubtelegrambot.service`
- unitat opcional del Bot API local:
  `gameclubtelegrambot-local-bot-api.service`
- backup nocturn: `gameclubtelegrambot-backup.service` i
  `gameclubtelegrambot-backup.timer`
- fitxer d'entorn: `/etc/default/gameclubtelegrambot`
- fitxer secrets runtime: `/etc/gameclubtelegrambot/.env`
- configuració runtime: `/etc/gameclubtelegrambot/runtime.json`
- configuració calculada del Bot API local:
  `/etc/default/gameclubtelegrambot-local-bot-api`
- backups complets: `/var/backups/gameclubtelegrambot`
- regla `polkit`:
  `/etc/polkit-1/rules.d/50-gameclubtelegrambot.rules`
- regles IA: `/etc/sudoers.d/gameclubtelegrambot-opencode` i
  `/etc/sudoers.d/gameclubtelegrambot-codex`

El servei assumeix que l'aplicació ja està construïda i que existeix:

- `dist/main.js`
- `dist/scripts/check-runtime-config.js`
- `dist/scripts/migrate.js`
- `node_modules/`

La instal·lació amb els valors per defecte copia `config/runtime.json` a
`/etc/gameclubtelegrambot/runtime.json` i el fitxer `.env` que hi ha al costat a
`/etc/gameclubtelegrambot/.env`. Per tant, els canvis manuals fets només sota
`/etc` es poden perdre al següent `./startup.sh`. Mantén la font desplegable al
repositori ignorat per Git o passa explícitament una altra ruta amb
`--config-source`.

## Wrappers d'IA i límit de privilegis

El servei corre com `gameclubbot`, però les credencials i els models de Codex i
OpenCode viuen al compte de l'usuari operador. El desplegament configura:

```text
GAMECLUB_OPENCODE_BIN=/opt/gameclubtelegrambot/scripts/opencode-cawa.sh
GAMECLUB_CODEX_BIN=/opt/gameclubtelegrambot/scripts/codex-cawa.sh
```

Els wrappers executen el binari real amb `sudo -n -H -u <operador>`. Les regles
`sudoers` generades no permeten executar ordres arbitràries com l'operador:
autoritzen exclusivament el path concret del binari OpenCode o Codex detectat
durant la instal·lació. `install-debian-stack.sh` valida les dues regles amb
`visudo` abans d'instal·lar-les.

No invoquis `opencode` ni `codex` directament des del procés del bot. Les
integracions han de llegir `GAMECLUB_OPENCODE_BIN` o `GAMECLUB_CODEX_BIN`.

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

Aquest script:

- atura i deshabilita `gameclubtelegrambot.service`
- atura i elimina el servei opcional del Bot API local
- atura i elimina el servei i timer de backup
- elimina les unitats instal·lades sota `/etc/systemd/system`
- elimina la configuració calculada del Bot API local
- elimina la regla `polkit`
- elimina les regles `sudoers` d'OpenCode i Codex
- elimina l'autostart de safata de l'usuari operador
- recarrega `systemd` i neteja l'estat fallit de la unitat principal

Abans d'executar canvis reals es pot revisar la seqüència:

```bash
./scripts/uninstall-debian-stack.sh --dry-run --operator-user "$USER"
```

No elimina `/opt/gameclubtelegrambot`, `/etc/gameclubtelegrambot`, els backups,
bases de dades, paquets del sistema, usuaris ni grups.

Comandes bàsiques d'operació:

```bash
sudo systemctl status gameclubtelegrambot.service
sudo systemctl restart gameclubtelegrambot.service
sudo systemctl stop gameclubtelegrambot.service
sudo systemctl start gameclubtelegrambot.service
```

## Recuperar comandes de Telegram que no responen

Si el bot rep missatges però algunes accions no generen resposta, comprova
primer si hi ha processos duplicats o validacions bloquejades:

```bash
pgrep -af "gameclubtelegrambot|node --import tsx --test|npm run typecheck|tsc --noEmit|tsx|dist/main.js" || true
systemctl status gameclubtelegrambot.service --no-pager
./scripts/service-journal.sh -n 120
```

L'estat correcte en producció és un únic procés del servei:

```text
/usr/bin/node /opt/gameclubtelegrambot/dist/main.js
```

La safata Debian pot tenir processos propis (`debian-tray.js` i
`debian-tray-host.py`), però no hi ha d'haver cap altre `dist/main.js` ni
processos de test/build actius. Si queden processos de validació (`node --test`,
`tsc`, `npm run typecheck`), espera que acabin o atura'ls abans de continuar.

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

Si el bot continua rebent updates però no respon, reinicia el servei per netejar
l'estat en memòria i reobrir el long polling:

```bash
systemctl restart gameclubtelegrambot.service
./scripts/service-journal.sh -n 50
```

Des de Telegram, un admin també pot executar `/restart` en privat. Aquesta
comanda esborra les sessions conversacionals `telegram.session:%`, neteja
l'estat temporal en memòria i força una sortida amb error controlat perquè
systemd aixequi un procés nou mitjançant `Restart=on-failure`. Si el bot no
arriba a processar cap comanda, usa el reinici per `systemctl` des de la
màquina.

El runtime manté un canari intern de Telegram API. Si una crida a Telegram falla
de manera transitòria (`timeout`, xarxa, 429 o 5xx), l'estat degradat queda
disponible per al diagnòstic intern. Es retira automàticament després de diversos
enviaments correctes i una finestra sense nous errors.

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

Comprovar logs recents amb el wrapper del projecte:

```bash
./scripts/service-journal.sh -n 50
```

Comprovar denegació de permisos en un usuari fora del grup operador.

## Relació amb la safata Debian

La safata Debian actual assumeix exactament aquesta convenció:

- nom de servei `gameclubtelegrambot.service`
- control via `systemctl`
- logs del servei via `./scripts/service-journal.sh` en operació manual
- permisos delegats a `polkit`

La implementació interna de la safata consulta el journal mitjançant la seva
capa de control. Si aquestes convencions canvien, també caldrà actualitzar
`service-control` i la UI de safata.

## Límits de seguretat de la unitat principal

La unitat principal aplica `PrivateTmp=yes` i `ProtectSystem=full`, però manté
`NoNewPrivileges=no` i `ProtectHome=no`. Això és necessari en el desplegament
actual perquè els wrappers d'IA puguin canviar a l'usuari operador i accedir a
les seves credencials. No s'ha de descriure la unitat com un sandbox complet.

El servidor HTTP integrat forma part del mateix procés i, per tant, comparteix
aquest usuari i aquests límits. Ha de romandre lligat a loopback i exposar-se
només mitjançant un reverse proxy HTTPS administrat. La configuració del
reverse proxy no està versionada en aquest repositori; consulta
`docs/admin-http-server.md` per al contracte i les comprovacions que sí són
verificables.

## Backup i recuperació

El runbook específic de backup, restore i recuperació és a:

- `docs/backup-restore-recovery.md`
