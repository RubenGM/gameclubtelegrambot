# Backup TUI Design

## Goal

Afegir una eina TUI per gestionar backups complets del bot sense substituir els scripts CLI existents.

La TUI ha de permetre:

- veure l'estat operatiu del sistema de backup
- veure l'estat resumit de la base de dades
- veure els backups disponibles
- crear backups complets
- restaurar backups complets
- auto-instal.lar dependencies necessaries quan faltin

## Scope

La v1 cobreix nomes:

- mantenir `scripts/backup-full.sh` i `scripts/restore-full.sh` com a entrypoints operatius reals
- afegir instal.lacio automatica de dependencies necessaries per backup/restore
- afegir una TUI terminal basada en `blessed`
- mostrar estat de configuracio, dependencies, servei, base de dades i backups existents
- crear i restaurar backups des de la TUI reutilitzant el CLI existent
- mostrar sortida resumida i errors de l'ultima operacio

La v1 no cobreix:

- substituir el CLI per la TUI
- exploracio completa de taules o files de PostgreSQL
- programacio automtica de backups amb cron o `systemd timer`
- suport multiplataforma fora de Debian/Linux
- xifrat o pujada remota dels backups

## Current Project Context

L'estat durador del bot viu avui en quatre llocs principals:

- `/etc/gameclubtelegrambot/runtime.json`
- `/etc/gameclubtelegrambot/.env`
- `/etc/default/gameclubtelegrambot`
- PostgreSQL

Els scripts `scripts/backup-full.sh` i `scripts/restore-full.sh` ja empaqueten i restauren aquests actius juntament amb fitxers opcionals de `systemd` i `polkit`.

El repositori ja te la dependencia `blessed`, de manera que es pot construir una TUI sense afegir una nova llibreria de UI terminal.

La decisio d'operacio ja validada amb l'usuari es:

1. el CLI es mante com a capa operativa oficial
2. la TUI nomes ajuda a gestionar aquesta capa
3. la base de dades s'ha de veure com a resum d'estat, no com a browser complet
4. quan faltin dependencies de sistema, s'han d'instal.lar automaticament per defecte

## Recommended Architecture

La solucio es divideix en quatre peces petites.

### 1. Shared Dependency Guard

Fitxers previstos:

- `scripts/lib/ensure-backup-dependencies.sh`
- possibles ajustos a `scripts/backup-postgres.sh`
- possibles ajustos a `scripts/restore-postgres.sh`
- possibles ajustos a `scripts/backup-full.sh`
- possibles ajustos a `scripts/restore-full.sh`

Responsabilitat:

- detectar si existeixen comandes necessaries com `pg_dump`, `psql`, `python3`, `node` i eines base de sistema
- instal.lar automaticament el paquet necessari quan falti una dependencia suportada
- fer-ho nomes en entorns Debian compatibles
- fallar amb un error curt i accionable si no hi ha `apt-get`, `sudo` o permisos suficients

Politica recomanada de dependències:

- `pg_dump` i `psql` es resolen instal.lant `postgresql-client`
- `python3` es resol amb el paquet `python3`
- no s'intenta instal.lar Node.js automaticament en v1; si falta, es retorna error clar perquè el projecte sencer depen de Node

Aquest guard s'ha de cridar al principi dels scripts CLI reals, de manera que tant el flux manual com el flux llançat des de la TUI comparteixin el mateix comportament.

### 2. Backup Operations and Status Layer

Fitxers previstos:

- `src/operations/backup-operations.ts`
- `src/operations/backup-status.ts`
- `src/operations/backup-types.ts`

Responsabilitat:

- encapsular totes les consultes d'estat que la TUI necessita
- llistar backups `.zip` disponibles dins del directori configurat
- obtenir metadades de cada backup: nom, mida, data, ruta, resultat d'inspeccio del manifest
- comprovar estat dels fitxers de configuracio requerits
- comprovar estat del servei `systemd`
- comprovar estat de dependencies del sistema
- comprovar connectivitat a PostgreSQL i obtenir resum de la BD
- executar `backup-full.sh` i `restore-full.sh` com a subprocessos controlats

API prevista:

- `readBackupConsoleStatus()`
- `listBackupArchives()`
- `createFullBackup()`
- `restoreFullBackup()`
- `readLastOperationLog()`

Model resumit de l'estat esperat:

- configuracio: present / absent / no llegible
- dependencies: instal.lades / instal.lant / absents / error
- servei: active / inactive / failed / unknown
- base de dades: connected / disconnected / error
- backups: nombre total, ultim backup, directori, errors de manifest si n'hi ha

### 3. Database Summary Reader

Fitxers previstos:

- `src/operations/database-summary.ts`

Responsabilitat:

- llegir la configuracio runtime
- obrir connexio PostgreSQL amb les mateixes credencials del bot
- calcular un resum curt i estable de la base de dades

Dades visibles en v1:

- host, port i nom de la base de dades
- estat de connexio
- mida total aproximada de la base de dades
- nombre de taules no internes
- recompte de files per a un conjunt petit de taules importants si existeixen

Regla important:

- els recomptes de files han de ser best effort i limitats a taules conegudes del bot; si una taula no existeix o la consulta falla, la UI ha de continuar mostrant la resta del resum sense convertir-se en un browser SQL complet

### 4. TUI Application

Fitxers previstos:

- `src/scripts/backup-console.ts`
- `src/tui/backup-console-app.ts`
- `src/tui/backup-console-layout.ts`

Responsabilitat:

- renderitzar la pantalla terminal
- refrescar estat manualment i en interval periodic
- permetre seleccionar backups i executar accions
- mostrar feedback curt durant operacions llargues

Layout recomanat:

- capcalera amb servei, config activa i directori de backups
- panell `System Status`
- panell `Database Summary`
- panell `Backups`
- panell `Actions`
- panell `Operation Log`

Accions minimes:

- `Refresh`
- `Create backup`
- `Restore selected backup`
- `Open backup folder path`
- `Quit`

Comportament de la TUI:

- en arrencar, carrega estat complet
- si falten dependencies suportades, intenta instal.lar-les abans de marcar l'estat final
- durant `Create backup`, bloqueja accions destructives fins que acabi el subprocess
- durant `Restore selected backup`, demana confirmacio explicita abans de continuar
- en acabar una operacio, refresca l'estat complet i la llista de backups

## Data Flow

### Backup creation flow

1. L'usuari obre la TUI.
2. La capa d'estat comprova config, dependencies, servei, DB i backups existents.
3. Si l'usuari prem `Create backup`, la capa d'operacions valida dependencies i en resol les absents.
4. La capa llança `scripts/backup-full.sh`.
5. La sortida es captura i es mostra al panell de log.
6. En acabar, la TUI rellegeix la carpeta de backups i actualitza l'ultim backup visible.

### Restore flow

1. L'usuari selecciona un `.zip` de la llista.
2. La TUI mostra un dialeg de confirmacio amb nom del fitxer i advertencia de sobreescriptura.
3. Si l'usuari confirma, la capa d'operacions valida dependencies i llança `scripts/restore-full.sh --input ...`.
4. La sortida es captura i es mostra al panell de log.
5. En acabar, la TUI rellegeix estat del servei, config i base de dades.

### Status refresh flow

1. La TUI executa `readBackupConsoleStatus()` en arrencar i en cada `Refresh`.
2. Aquesta capa comprova fitxers, servei, dependencies, base de dades i backups.
3. La UI normalitza el resultat en etiquetes curtes i colors simples.

## Backup Content Contract

Per considerar un backup complet valid a la v1, el `.zip` ha de contenir com a minim:

- `config/runtime.json`
- `config/runtime.env`
- `config/default.env`
- `database/postgres.sql.gz`

I opcionalment:

- `systemd/<service-name>`
- `polkit/<rule-file>`
- `metadata/manifest.txt`
- `metadata/restore-notes.txt`

La TUI no ha de redefinir aquest contracte. Nomes l'ha de llegir i mostrar.

## Failure Handling

Casos a cobrir:

- falta `postgresql-client`
- falta `python3`
- no hi ha permisos per usar `sudo` o `apt-get`
- la configuracio runtime no existeix o no es pot llegir
- la base de dades no respon
- el backup seleccionat no te el format esperat
- el restore falla a mig proces
- el servei no es pot arrencar despres del restore

Resposta esperada:

- la capa operativa retorna errors tipats o missatges curts i estables
- la TUI mostra l'error principal i la sortida rellevant de l'operacio
- el CLI conserva sortida textual completa per a l'operador

Regles de seguretat:

- no s'intenta restaurar sense confirmacio explicita
- no s'elimina cap backup des de la v1
- no s'intenta ocultar errors de `pg_dump`, `psql`, `systemctl` o `apt-get`
- la instal.lacio automatica nomes actua sobre dependencies conegudes i paquets predefinits

## Testing Strategy

La v1 s'ha de validar amb proves proporcionals al risc i al tipus de canvi.

Cobertura recomanada:

- tests unitaris per a parseig de manifests i llistat de backups
- tests unitaris per a normalitzacio de l'estat de servei, config i dependencies
- tests unitaris per al model de resum de base de dades quan falten camps o fallen recomptes opcionals
- validacio manual de la TUI en terminal real
- validacio manual del flux `Create backup`
- validacio manual del flux `Restore selected backup` en entorn de prova controlat

Per la part shell:

- comprovacio de sintaxi `bash -n`
- execucio `--dry-run` dels scripts afectats

## Minimal Implementation Plan Shape

L'ordre recomanat d'implementacio es:

1. extreure el guard comu de dependencies i connectar-lo al CLI existent
2. crear la capa TypeScript d'estat i operacions
3. afegir el resum de base de dades
4. construir la TUI sobre aquesta capa
5. actualitzar documentacio d'operacio

Aquest ordre mante el CLI funcional en tot moment i permet validar la logica abans de muntar la UI terminal.
