# Bootstrap Wizard

Aquest document descriu les decisions tècniques del wizard interactiu de primer arrencada.

## Objectiu actual

El wizard de `GAM-18` recull tota la configuració obligatòria i construeix un `RuntimeConfig` complet en memòria.

No persisteix encara el fitxer a disc.

Aquesta persistència queda explícitament per al ticket següent (`GAM-19`).

## Punt d'entrada

Comanda principal:

`npm run bootstrap:wizard`

Entry point:

`src/scripts/bootstrap-wizard.ts`

El wizard està separat del camí principal del bot (`src/main.ts`) i no arrenca ni Telegram ni PostgreSQL.

## Decisions tècniques

### 1. Contracte canònic únic

El wizard construeix directament un objecte compatible amb `runtimeConfigSchema`.

No existeix un segon format de bootstrap diferent del runtime.

Rao:

- evita conversions posteriors
- evita divergència entre el wizard i el loader runtime
- prepara `GAM-19` perquè només hagi de persistir i aplicar el mateix contracte

### 2. Validació primerenca per camp

Cada resposta es valida tan aviat com és possible:

- textos obligatoris no poden quedar buits
- enters es validen abans de continuar
- booleans només accepten variants clares de `si` o `no`
- els secrets també es validen com a obligatoris

Després es fa una validació final del candidat complet amb `runtimeConfigSchema`.

### 3. Secrets no mostrats en clar

Els camps sensibles es demanen com a entrada oculta en terminal:

- `telegram.token`
- `database.password`
- `adminElevation.password`

En el resum final no es mostren en clar.

Només es mostra:

- que hi ha un valor informat
- la longitud del valor

Exemple:

`[valor ocult, 21 caracters]`

### 4. Defaults explícits

Per reduir fricció a una instal·lació Debian local, el wizard proposa aquests defaults:

- `database.host = 127.0.0.1`
- `database.port = 55432`
- `database.name = gameclub`
- `database.user = gameclub_user`
- `database.ssl = false`
- `notifications.defaults.groupAnnouncementsEnabled = true`
- `notifications.defaults.eventRemindersEnabled = true`
- `notifications.defaults.eventReminderLeadHours = 24`
- `featureFlags.bootstrapWizard = true`

La contrasenya de base de dades, el token de Telegram i la contrasenya d'elevació admin no tenen default.

### 5. Identitat del primer administrador no inferida

El wizard demana explícitament:

- `bootstrap.firstAdmin.telegramUserId`
- `bootstrap.firstAdmin.username` opcional
- `bootstrap.firstAdmin.displayName`

Decisió important:

- `telegramUserId` és la identitat canònica
- `username` és només ajuda humana
- el sistema no ha d'inferir el primer admin a partir del primer usuari que escriu al bot

### 6. Confirmació abans de persistir

Abans d'acabar, el wizard mostra un resum humà de la configuració recollida i demana confirmació.

Si l'operador rebutja el resum:

- el wizard retorna `null`
- no es persisteix res
- no es deixa cap efecte lateral

## Ordre actual de preguntes

1. Nom públic del bot
2. Nom del club
3. Token del bot de Telegram
4. Host de PostgreSQL
5. Port de PostgreSQL
6. Nom de la base de dades
7. Usuari de la base de dades
8. Contrasenya de la base de dades
9. Contrasenya d'elevació administrativa
10. Telegram user ID del primer administrador
11. Username del primer administrador
12. Nom visible del primer administrador
13. Activar anuncis de grup per defecte
14. Activar recordatoris d'esdeveniments per defecte
15. Antelació dels recordatoris en hores

## Arquitectura interna

Fitxers principals:

- `src/bootstrap/wizard/run-bootstrap-wizard.ts`
- `src/bootstrap/wizard/terminal-wizard-io.ts`
- `src/scripts/bootstrap-wizard.ts`

Separació de responsabilitats:

- `run-bootstrap-wizard.ts`
  - conté el flux de preguntes
  - conté la validació primerenca
  - construeix el candidat en memòria
  - genera el resum final
- `terminal-wizard-io.ts`
  - encapsula la interacció real amb terminal
  - oculta entrada de secrets
- `bootstrap-wizard.ts`
  - actua com a entrypoint executable
  - manté el wizard separat del runtime del servei

## Proves

Cobertura principal a:

`src/bootstrap/wizard/run-bootstrap-wizard.test.ts`

Es comprova:

- ordre del flux
- aplicació de defaults
- reintents en cas d'entrada invàlida
- emmascarament de secrets al resum
- cancel·lació per manca de confirmació final

## Decisions obertes per al següent ticket

`GAM-19` haurà de decidir i implementar:

- on s'escriu exactament el fitxer final
- com es protegeix la reinitialització accidental
- com es crea el primer administrador aprovat a la persistència real
- com es connecta la confirmació del wizard amb l'escriptura efectiva del JSON
