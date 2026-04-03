# Runtime Configuration

Aquest document descriu el contracte runtime actual que el procés carrega abans de continuar l'arrencada.

## Ruta per defecte

El fitxer de configuració runtime es llegeix per defecte des de:

`config/runtime.json`

Per sobreescriure aquesta ruta es pot fer servir:

`GAMECLUB_CONFIG_PATH=/ruta/al/fitxer.json`

## Comportament d'arrencada

L'aplicació valida tota la configuració abans de continuar l'startup.

Després de validar-la, intenta establir connexió real amb `PostgreSQL`.

També valida el token de `Telegram` i arrenca el bot en `long polling`.

El procés registra fites clares d'arrencada i, quan rep `SIGINT` o `SIGTERM`, intenta tancar Telegram i PostgreSQL de forma ordenada.

L'arrencada s'atura si passa qualsevol d'aquests casos:

- el fitxer no existeix
- el fitxer no es pot llegir
- el contingut no és JSON vàlid
- algun camp no compleix l'esquema definit
- la base de dades no és accessible amb la configuració indicada
- el token de Telegram és invàlid o la inicialització del bot falla

Els errors inesperats de procés (`uncaughtException` i `unhandledRejection`) també segueixen un camí definit: es registren com a fatals i es força un shutdown controlat abans de sortir.

## Contracte actual

El contracte runtime actual inclou:

- `bot.publicName`
- `bot.clubName`
- `bot.iconPath` opcional
- `telegram.token`
- `database.host`
- `database.port`
- `database.name`
- `database.user`
- `database.password`
- `database.ssl`
- `adminElevation.password`
- `featureFlags` com a mapa de claus booleanes

## Exemple de configuració

```json
{
  "bot": {
    "publicName": "Game Club Bot",
    "clubName": "Game Club",
    "iconPath": "/opt/gameclub/assets/icon.png"
  },
  "telegram": {
    "token": "telegram-token"
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
    "password": "admin-secret"
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

## Workflow de migracions

L'esquema font viu a:

`src/infrastructure/database/schema.ts`

La configuració de `drizzle-kit` viu a:

`drizzle.config.ts`

Comandes canòniques:

- `npm run db:generate` per generar una migració SQL nova a `drizzle/`
- `npm run db:migrate` per aplicar les migracions pendents contra la base de dades configurada

No es fa cap auto-sync implícit durant l'arrencada de l'aplicació. L'execució de migracions és sempre explícita.
