# Runtime Configuration

Aquest document descriu el contracte runtime actual que el procés carrega abans de continuar l'arrencada.

## Ruta per defecte

El fitxer de configuració runtime es llegeix per defecte des de:

`config/runtime.json`

Per sobreescriure aquesta ruta es pot fer servir:

`GAMECLUB_CONFIG_PATH=/ruta/al/fitxer.json`

## Comportament d'arrencada

Abans d'arrencar el runtime normal, l'aplicació resol l'estat global d'inicialització.

Els casos actuals són:

- `fresh`: no existeix configuració runtime final i no hi ha senyals de bootstrap parcial; si hi ha TTY interactiva es llança el wizard inicial
- `initialized`: la configuració runtime és vàlida i la base de dades conté el marcador durable d'inicialització coherent amb el primer administrador
- `ambiguous`: existeix una combinació inconsistent de configuració, fitxers temporals o estat de base de dades; el procés es bloqueja amb instruccions per a l'operador

Quan l'estat és `initialized`, l'aplicació valida tota la configuració abans de continuar l'startup.

Després de validar-la, intenta establir connexió real amb `PostgreSQL`.

També valida el token de `Telegram` i arrenca el bot en `long polling`.

El procés registra fites clares d'arrencada i, quan rep `SIGINT` o `SIGTERM`, intenta tancar Telegram i PostgreSQL de forma ordenada.

L'arrencada s'atura si passa qualsevol d'aquests casos:

- el fitxer no existeix
- el fitxer no existeix i no hi ha una terminal interactiva per completar el bootstrap inicial
- el fitxer no es pot llegir
- el contingut no és JSON vàlid
- algun camp no compleix l'esquema definit
- la base de dades no és accessible amb la configuració indicada
- el token de Telegram és invàlid o la inicialització del bot falla
- es detecta un estat ambigu de bootstrap, per exemple un `.tmp` pendent o un marcador d'inicialització inconsistent

Els errors inesperats de procés (`uncaughtException` i `unhandledRejection`) també segueixen un camí definit: es registren com a fatals i es força un shutdown controlat abans de sortir.

## Contracte actual

El contracte runtime actual inclou:

- `schemaVersion` amb valor actual `1`
- `bot.publicName`
- `bot.clubName`
- `bot.iconPath` opcional
- `telegram.token`
- `bgg.apiKey` opcional per activar BoardGameGeek com a font principal d'importacio de jocs de taula; es fa servir com a bearer token HTTP
- `database.host`
- `database.port`
- `database.name`
- `database.user`
- `database.password`
- `database.ssl`
- `adminElevation.passwordHash`
- `bootstrap.firstAdmin.telegramUserId`
- `bootstrap.firstAdmin.username` opcional
- `bootstrap.firstAdmin.displayName`
- `notifications.defaults.groupAnnouncementsEnabled` amb default `true`
- `notifications.defaults.eventRemindersEnabled` amb default `true`
- `notifications.defaults.eventReminderLeadHours` amb default `24`
- `featureFlags` com a mapa de claus booleanes

## Exemple de configuració

```json
{
  "schemaVersion": 1,
  "bot": {
    "publicName": "Game Club Bot",
    "clubName": "Game Club",
    "iconPath": "/opt/gameclub/assets/icon.png"
  },
  "telegram": {
    "token": "telegram-token"
  },
  "bgg": {
    "apiKey": "bgg-api-key"
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "gameclub",
    "user": "gameclub_user",
    "password": "super-secret",
    "ssl": false
  },
  "adminElevation": {
    "passwordHash": "scrypt:16384:8:1:..."
  },
  "bootstrap": {
    "firstAdmin": {
      "telegramUserId": 123456789,
      "username": "club_admin",
      "displayName": "Club Administrator"
    }
  },
  "notifications": {
    "defaults": {
      "groupAnnouncementsEnabled": true,
      "eventRemindersEnabled": true,
      "eventReminderLeadHours": 24
    }
  },
  "featureFlags": {
    "bootstrapWizard": true,
    "newsGroups": false
  }
}
```

## Notes de disseny

- Aquesta estructura està pensada per ser prou estable per al futur assistent de bootstrap.
- El codi de l'aplicació ha de consumir objectes tipats de configuració, no JSON cru.
- Si en el futur canvia la ruta o el format, caldrà documentar explícitament la migració.
- El mateix contracte runtime s'utilitza per obrir la connexió de l'aplicació i per executar migracions explícites.
- La capa visible de menús de Telegram es resol fora del transport baix nivell; les definicions declaratives viuen a `src/telegram/action-menu.ts` i combinen rol, context de xat i sessió activa.
- L'estat d'inicialització validat es complementa amb un marcador durable a `app_metadata` sota la clau `bootstrap.initialization`.
- `bot.*` descriu metadata visible del club i del bot; no ha de barrejar-se amb secrets.
- `telegram.*` i `database.*` són configuració operativa; `adminElevation.passwordHash` és un secret derivat persistit, no la contrasenya en clar.
- `bgg.apiKey` activa BoardGameGeek com a font principal per a la importació de jocs i s'envia com a `Authorization: Bearer ...`; si no hi és, el sistema continua amb Wikipedia com a fallback extrem.
- el runtime final mai no necessita recuperar la contrasenya d'elevació original; només necessita poder verificar-la en el futur.
- `bootstrap.firstAdmin.*` descriu la identitat inicial que el wizard ha de persistir; el sistema no l'ha d'inferir a partir del primer usuari que escriu al bot.
- `bootstrap.firstAdmin.telegramUserId` és la identitat canònica; `username` només és ajuda humana i no s'ha d'usar com a clau única.
- `notifications.defaults.*` defineix defaults explícits per al primer arrencada; no s'han d'inferir implícitament a partir de feature flags o del context del xat.
- Camps futurs opcionals s'han d'afegir amb defaults o amb una nova `schemaVersion`, evitant trencar configs persistides de versions anteriors.

## Workflow de migracions

L'esquema font viu a:

`src/infrastructure/database/schema.ts`

La configuració de `drizzle-kit` viu a:

`drizzle.config.ts`

Comandes canòniques:

- `npm run db:generate` per generar una migració SQL nova a `drizzle/`
- `npm run db:migrate` per aplicar les migracions pendents contra la base de dades configurada

No es fa cap auto-sync implícit durant l'arrencada de l'aplicació. L'execució de migracions és sempre explícita.
