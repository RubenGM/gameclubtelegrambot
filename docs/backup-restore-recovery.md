# Backup, Restore And Recovery

Aquest document defineix el runbook operatiu per mantenir `gameclubtelegrambot` recuperable en una màquina Debian autogestionada.

## Objectiu

L'operador ha de poder recuperar el servei sense haver d'inspeccionar el codi font sota pressió.

Aquest runbook cobreix:

- què s'ha de guardar en backup
- amb quina freqüència mínima és raonable fer-ho
- com restaurar configuració i PostgreSQL
- com tornar a deixar el servei operatiu després d'una incidència o canvi de màquina

## Què s'ha de fer backup

Mínim imprescindible:

- `/etc/gameclubtelegrambot/runtime.json`
- `/etc/default/gameclubtelegrambot`
- un dump PostgreSQL de la base de dades configurada al runtime

Molt recomanable guardar també:

- el commit desplegat o un paquet/export de la versió instal·lada
- qualsevol canvi local sobre unitats `systemd` o fitxers de `deploy/`
- una còpia d'aquest runbook junt amb els últims dumps disponibles

## Freqüència recomanada

Per un club petit o mitjà amb màquina Debian pròpia:

- `runtime.json` i `/etc/default`: backup cada cop que es modifiquin
- PostgreSQL: almenys un cop al dia si hi ha ús regular del bot
- backup extra abans de:
  - aplicar migracions noves
  - canviar de màquina
  - actualitzar la versió desplegada
  - tocar manualment `systemd`, `polkit` o la configuració runtime

## Scripts operatius inclosos

El repositori inclou dos scripts simples per ajudar l'operador:

- `./scripts/backup-postgres.sh`
- `./scripts/restore-postgres.sh`

Els dos llegeixen la connexió PostgreSQL des de `GAMECLUB_CONFIG_PATH` o, si no s'indica res, de `/etc/gameclubtelegrambot/runtime.json`.

### Backup de PostgreSQL

Exemple habitual:

```bash
./scripts/backup-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --output-dir /var/backups/gameclubtelegrambot
```

Mode simulació:

```bash
./scripts/backup-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --output-dir /var/backups/gameclubtelegrambot --dry-run
```

El resultat és un fitxer `gameclub-postgres-YYYYMMDD-HHMMSS.sql.gz`.

### Restore de PostgreSQL

Exemple habitual:

```bash
./scripts/restore-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --input /var/backups/gameclubtelegrambot/gameclub-postgres-20260404-120000.sql.gz
```

Mode simulació:

```bash
./scripts/restore-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --input /var/backups/gameclubtelegrambot/gameclub-postgres-20260404-120000.sql.gz --dry-run
```

## Procediment de backup recomanat

### 1. Configuració

Guardar com a mínim:

```bash
sudo install -d /var/backups/gameclubtelegrambot
sudo cp /etc/gameclubtelegrambot/runtime.json /var/backups/gameclubtelegrambot/runtime.json
sudo cp /etc/default/gameclubtelegrambot /var/backups/gameclubtelegrambot/default.env
```

### 2. Base de dades

Executar:

```bash
./scripts/backup-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --output-dir /var/backups/gameclubtelegrambot
```

### 3. Verificació mínima

Comprovar que existeixen:

- `runtime.json`
- `default.env`
- un `.sql.gz` recent

## Restore complet en una màquina nova o reparada

Ordre recomanat:

### 1. Desplegar l'aplicació

Recuperar el codi o la versió desplegada i executar el camí Debian normal:

```bash
./scripts/install-debian-stack.sh --config-source ./config/runtime.json --operator-user "$USER" --no-start
```

Si no vols sobreescriure encara la configuració final restaurada, pots desplegar primer l'app i després copiar manualment els fitxers sota `/etc`.

### 2. Restaurar configuració

```bash
sudo install -d /etc/gameclubtelegrambot
sudo cp /var/backups/gameclubtelegrambot/runtime.json /etc/gameclubtelegrambot/runtime.json
sudo cp /var/backups/gameclubtelegrambot/default.env /etc/default/gameclubtelegrambot
```

### 3. Validar la configuració

```bash
cd /opt/gameclubtelegrambot
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/check-runtime-config.js
```

### 4. Aturar el servei abans de tocar la BD

```bash
sudo systemctl stop gameclubtelegrambot.service
```

### 5. Restaurar PostgreSQL

```bash
cd /opt/gameclubtelegrambot
./scripts/restore-postgres.sh --config /etc/gameclubtelegrambot/runtime.json --input /var/backups/gameclubtelegrambot/<dump.sql.gz>
```

### 6. Aplicar migracions si la versió desplegada és més nova que el dump

```bash
cd /opt/gameclubtelegrambot
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/migrate.js
```

### 7. Arrencar el servei i verificar-lo

```bash
sudo systemctl start gameclubtelegrambot.service
sudo systemctl status gameclubtelegrambot.service
journalctl -u gameclubtelegrambot.service -n 50 --no-pager
```

## Recuperació per incidències habituals

### Cas 1. El servei no arrenca després d'un reinici

Comprovacions immediates:

```bash
sudo systemctl status gameclubtelegrambot.service
journalctl -u gameclubtelegrambot.service -n 100 --no-pager
```

Motius habituals a revisar:

- falta `/etc/gameclubtelegrambot/runtime.json`
- falta `dist/main.js`
- `runtime.json` és invàlid
- PostgreSQL no és accessible
- el token de Telegram és incorrecte

Validacions útils:

```bash
cd /opt/gameclubtelegrambot
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/check-runtime-config.js
GAMECLUB_CONFIG_PATH=/etc/gameclubtelegrambot/runtime.json node dist/scripts/migrate.js
```

### Cas 2. S'ha perdut o malmès la configuració

Acció recomanada:

1. restaurar `runtime.json` i `/etc/default/gameclubtelegrambot` des de backup
2. validar la configuració amb `check-runtime-config.js`
3. reiniciar el servei

No intentis reconstruir manualment el fitxer sota pressió si existeix una còpia de backup bona.

### Cas 3. Cal moure el bot a una altra màquina Debian

Seqüència recomanada:

1. fer backup de configuració i PostgreSQL a la màquina antiga
2. desplegar l'app a la màquina nova
3. restaurar configuració
4. restaurar la base de dades
5. aplicar migracions si cal
6. arrencar i validar el servei

### Cas 4. Hi ha dubtes sobre si el dump correspon a l'esquema actual

Prioritat:

1. restaurar el dump
2. executar migracions explícites
3. validar l'arrencada real del servei

L'app no fa auto-sync implícit d'esquema durant el boot normal.

## Checklist de retorn a servei

Abans de considerar la recuperació tancada:

- `runtime.json` restaurat i validat
- base de dades restaurada
- migracions aplicades si feien falta
- servei `gameclubtelegrambot.service` en estat `active`
- logs recents sense errors crítics d'arrencada
- el bot respon a `/start` o a la comprovació bàsica prevista

## Relació amb altres documents

- `docs/runtime-configuration.md` — contracte de `runtime.json`
- `docs/debian-service-operations.md` — deploy i operació del servei Debian
- `docs/debian-tray-operations.md` — operació de la safata Debian
