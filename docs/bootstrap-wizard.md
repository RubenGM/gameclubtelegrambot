# Bootstrap Wizard

Aquest document descriu les decisions tècniques del wizard interactiu de primer arrencada.

## Objectiu actual

El wizard recull tota la configuració obligatòria, construeix un candidat complet en memòria i, després de la confirmació final, inicialitza el sistema de forma usable.

Actualment això inclou:

- persistir `config/runtime.json` o la ruta indicada a `GAMECLUB_CONFIG_PATH`
- hashejar `adminElevation.password` abans d'escriure el fitxer final
- executar migracions pendents
- crear el primer administrador aprovat a la base de dades

## Punt d'entrada

Comanda principal:

`npm run bootstrap:wizard`

Entry point:

`src/scripts/bootstrap-wizard.ts`

El wizard continua tenint entrypoint propi a `src/scripts/bootstrap-wizard.ts`, però el camí principal del bot (`src/main.ts`) ara també pot derivar automàticament cap al bootstrap quan detecta un primer arrencada real.

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

### 7. Persistència i seeding acoblats

La inicialització completa només es dona per bona quan s'han completat tots dos passos:

- persistència del fitxer runtime final
- creació del primer administrador aprovat a la base de dades

Decisió tècnica:

- el fitxer es prepara primer en un `.tmp` amb permisos restrictius
- després s'executen migracions i seed a base de dades
- dins de la inicialització de base de dades també s'escriu el marcador durable `bootstrap.initialization` a `app_metadata`
- només al final es promociona el fitxer temporal a la ruta definitiva
- si la promoció final del fitxer falla, s'intenta rollback del seed del primer admin i s'elimina el temporal

Objectiu:

- evitar un sistema mig inicialitzat i ambigu tant com sigui possible dins dels límits de fitxer + BD sense una transacció distribuïda real

### 8. Contrasenya d'elevació no persistida en clar

El wizard demana `adminElevation.password` en clar només de manera transitòria.

Abans d'escriure configuració a disc:

- es deriva `adminElevation.passwordHash`
- el valor en clar no s'escriu al JSON final

Format actual del hash:

`scrypt:<cost>:<blockSize>:<parallelization>:<saltHex>:<derivedKeyHex>`

Rao:

- la contrasenya només servirà després per validació, no per ser recuperada
- el ticket demanava explícitament no persistir-la en clar si el disseny no ho requeria

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
- `src/bootstrap/initialize-system.ts`
- `src/bootstrap/bootstrap-database.ts`
- `src/security/password-hash.ts`

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
  - orquestra la inicialització completa després de la confirmació final
- `initialize-system.ts`
  - transforma el candidat en configuració runtime persistible
  - hasheja la contrasenya d'elevació
  - escriu el fitxer temporal i el promociona a definitiu
  - coordina rollback si el pas final falla
- `bootstrap-database.ts`
  - executa migracions
  - crea el primer administrador aprovat en transacció
  - pot eliminar aquest primer admin si cal compensar una fallada final de persistència
- `password-hash.ts`
  - encapsula el hash `scrypt` del secret d'elevació

## Proves

Cobertura principal a:

`src/bootstrap/wizard/run-bootstrap-wizard.test.ts`

Es comprova:

- ordre del flux
- aplicació de defaults
- reintents en cas d'entrada invàlida
- emmascarament de secrets al resum
- cancel·lació per manca de confirmació final
- persistència segura del fitxer runtime
- hash no reversible del secret d'elevació
- seeding i rollback del primer administrador

## Decisions obertes per al següent ticket

`GAM-19` haurà de decidir i implementar:

`GAM-20` haurà de reforçar sobretot:

- protecció contra reinitialització accidental abans fins i tot d'arribar al wizard
- detecció explícita d'instal·lació ja inicialitzada
- UX de rerun i recuperació més guiada per a l'operador

Estat actual després de `GAM-20`:

- `src/main.ts` resol l'estat `fresh` / `initialized` / `ambiguous` abans d'arrencar
- `src/scripts/bootstrap-wizard.ts` també fa preflight i bloqueja reruns sobre sistemes ja inicialitzats o ambigus
- el marcador durable de bootstrap viu a `app_metadata` i es valida contra el primer administrador persistit
