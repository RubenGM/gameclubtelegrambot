# Catalog Loans Design

## Goal

Afegir persistència de préstecs per saber en tot moment qui té cada joc o llibre, amb una UI Telegram amb botons inline i una vista `Els meus préstecs`.

## Scope

La v1 cobreix nomes:

- un préstec actiu per item com a maxim
- historial de préstecs i retorns
- botons inline al cataleg i a la fitxa de l'item
- vista `Els meus préstecs` per a usuaris amb préstecs actius
- edicio d'un prestec actiu nomes pel creador o per admins
- edicio limitada a `notes` i `data de retorn`

La v1 no cobreix:

- reserves futures
- multitransferencies directes
- penalitzacions
- venciments automatitzats
- sincronitzacio amb cap sistema extern

## Current Project Context

El projecte ja disposa de:

- model de cataleg amb families, grups, items i media
- flux de lectura del cataleg per a membres
- pantalles de detall amb botons inline
- sessions de conversa reutilitzables per guardar estat de navegacio

Ara mateix la informacio de disponibilitat del cataleg es mostra des de metadades opcionals, pero no hi ha una font de veritat persistent per als prestecs.

## Recommended Architecture

### 1. Loan Persistence Layer

Fitxers nous previstos:

- `src/catalog/catalog-loan-model.ts`
- `src/catalog/catalog-loan-store.ts`
- `src/catalog/catalog-loan-store.test.ts`

Responsabilitat:

- guardar i recuperar prestecs
- impedir dos prestecs actius sobre el mateix item
- conservar historial quan un prestec es tanca

Model recomanat:

- `catalog_loans`
- camps principals:
  - `id`
  - `itemId`
  - `borrowerTelegramUserId`
  - `borrowerDisplayName`
  - `loanedByTelegramUserId`
  - `loanedAt`
  - `dueAt` opcional
  - `notes` opcional
  - `returnedAt` opcional
  - `returnedByTelegramUserId` opcional
  - `createdAt`
  - `updatedAt`

Regla clau:

- un item nomes pot tenir un prestec actiu si `returnedAt` es nul

### 2. Catalog Read Enrichment

Fitxers a ampliar:

- `src/telegram/catalog-presentation.ts`
- `src/telegram/catalog-read-flow.ts`

Responsabilitat:

- llegir l'estat actual del prestec actiu per item
- mostrar `Disponible` o `En préstec`
- indicar qui el te i, si existeix, la data de retorn prevista

La fitxa de l'item ha de continuar mostrant disponibilitat encara que el cataleg canviï de forma, pero la veritat operativa ha de venir de la taula de prestecs.

### 3. Telegram Loan Actions

Fitxers nous o a ampliar:

- `src/telegram/catalog-loan-flow.ts`
- `src/telegram/runtime-boundary.ts`
- `src/telegram/catalog-read-flow.ts`

Responsabilitat:

- afegir botons inline de `Prestar`, `Retornar` i `Editar prestec`
- mostrar `Els meus préstecs` nomes si l'usuari te almenys un prestec actiu
- permetre editar nomes a:
  - creador del prestec
  - admins

Comportament previst:

- `Prestar` crea el prestec actiu per a l'usuari seleccionat
- `Retornar` tanca el prestec actiu
- `Editar prestec` permet modificar nomes `notes` i `dueAt`
- si un item ja esta prestat, la UI ho mostra clarament abans de crear cap altre prestec

### 4. Telegram Navigation

La vista `Els meus préstecs` apareix dins del flux de lectura del cataleg, amb la condicio:

- l'usuari te almenys un prestec actiu

La vista ha de mostrar:

- items en prestec
- data de sortida
- data de retorn prevista si existeix
- botons per obrir la fitxa de l'item i retornar-lo

## Data Flow

### Crear prestec

1. L'usuari prem `Prestar` a la fitxa de l'item.
2. La capa de prestecs comprova que no hi hagi cap prestec actiu per aquest item.
3. Si no n'hi ha, crea el prestec amb les dades del prestatari i del creador.
4. La fitxa es refresca amb estat `En préstec`.

### Retornar prestec

1. L'usuari prem `Retornar`.
2. La capa de prestecs valida que hi hagi un prestec actiu.
3. Si l'usuari no es el creador i no es admin, no veura l'opcio d'editar, pero si podrà retornar si la UI li ho permet.
4. El prestec es tanca omplint `returnedAt` i `returnedByTelegramUserId`.

### Editar prestec

1. L'usuari prem `Editar prestec`.
2. La UI mostra els camps editables.
3. Només es poden canviar `notes` i `dueAt`.
4. Només es mostra l'accio si l'usuari es el creador o un admin.

## Failure Handling

Casos a cobrir:

- intent de crear un segon prestec actiu per al mateix item
- retorn d'un item que no esta prestat
- edicio d'un prestec per part d'un usuari no autoritzat
- dades persistides corruptes o incompletes

Resposta esperada:

- errors curts i clars
- cap canvi parcial si la transaccio no es pot completar

Exemples:

- `Aquest item ja esta prestat.`
- `Aquest item no te cap prestec actiu.`
- `No tens permisos per editar aquest prestec.`

## Testing Strategy

### Unit Tests

Cobrir la capa de persistencia per:

- crear prestec actiu
- impedir duplicats actius
- retornar prestec
- editar notes i data de retorn
- consultar prestecs actius per usuari

Cobrir Telegram per:

- mostrar botons inline de prestec
- mostrar `Els meus préstecs`
- mostrar disponibilitat al detall de l'item
- ocultar l'opcio d'editar si l'usuari no es el creador ni admin

### Manual Checks

- prestar un item des de Telegram
- verificar que apareix a `Els meus préstecs`
- retornar-lo des de la mateixa vista
- comprovar que la fitxa mostra l'estat correctament
