# Runtime Configuration

Aquest document descriu el contracte runtime actual que el procés carrega abans de continuar l'arrencada.

## Ruta per defecte

El fitxer de configuració runtime es llegeix per defecte des de:

`config/runtime.json`

Per sobreescriure aquesta ruta es pot fer servir:

`GAMECLUB_CONFIG_PATH=/ruta/al/fitxer.json`

## Comportament d'arrencada

L'aplicació valida tota la configuració abans de continuar l'startup.

L'arrencada s'atura si passa qualsevol d'aquests casos:

- el fitxer no existeix
- el fitxer no es pot llegir
- el contingut no és JSON vàlid
- algun camp no compleix l'esquema definit

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
