# Debian Service Operations

Aquest document descriu com desplegar i operar `gameclubtelegrambot` com a servei de sistema a Debian.

## Objectiu

Aquest paquet de desplegament prepara tres peces:

- una unitat `systemd` per executar el bot de forma persistent
- una regla `polkit` limitada al servei del bot
- convencions d'entorn perquè futures eines d'operació, com la safata Debian, el puguin controlar amb seguretat

## Instal·lació ràpida de tota la pila

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
- crea `/etc/default/gameclubtelegrambot`
- valida la configuració runtime instal·lada
- aplica les migracions pendents abans d'arrencar el servei
- instal·la `systemd`, `polkit` i autostart de la safata
- arrenca el servei si no s'indica `--no-start`

## Convencions operatives

La proposta actual assumeix aquestes rutes i identitats:

- directori d'aplicació: `/opt/gameclubtelegrambot`
- usuari del servei: `gameclubbot`
- grup del servei: `gameclubbot`
- grup d'operadors amb permís de control: `gameclubbot-operators`
- unitat de sistema: `gameclubtelegrambot.service`
- fitxer d'entorn: `/etc/default/gameclubtelegrambot`

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

Comandes bàsiques d'operació:

```bash
sudo systemctl status gameclubtelegrambot.service
sudo systemctl restart gameclubtelegrambot.service
sudo systemctl stop gameclubtelegrambot.service
sudo systemctl start gameclubtelegrambot.service
```

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
