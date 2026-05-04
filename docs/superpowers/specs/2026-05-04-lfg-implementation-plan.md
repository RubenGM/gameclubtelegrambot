# LFG Implementation Plan

## Goal

Implementar `LFG` como una nueva capacidad del bot para ayudar a socios del club a encontrar gente para jugar.

La feature debe funcionar como un tablon temporal de anuncios, no como un sistema para crear o mantener grupos persistentes.

Hay dos tipos de anuncios:

- `Jugador busca grupo`: una persona indica que quiere unirse a una partida o grupo.
- `Grupo busca jugadores`: una persona publica que necesita jugadores para una partida o grupo concreto.

Cuando el creador consigue el contacto necesario, marca el anuncio como resuelto. El anuncio desaparece de las listas activas, pero no se borra fisicamente en la v1.

## Source Documents

- `src/telegram/action-menu.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/i18n.ts`
- `src/infrastructure/database/schema.ts`
- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `drizzle/`

## Planning Principles

- El menu principal debe recibir solo un boton nuevo: `LFG`.
- Las acciones internas deben vivir en un submenu propio para no llenar el teclado principal.
- Los anuncios son temporales y operativos; no representan entidades de grupo duraderas.
- Resolver o cancelar debe ocultar de listados activos sin borrado fisico.
- Las reglas de negocio deben vivir en el dominio `src/lfg`, no en handlers Telegram.
- La capa Telegram debe limitarse a orquestar sesiones, callbacks, textos y presentacion.
- La persistencia debe seguir el patron Drizzle actual con `db.select()` builder API.
- La v1 debe evitar matching automatico y notificaciones globales para no introducir ruido.

## Scope

Incluido en v1:

- nuevo boton `LFG` en el menu principal para usuarios aprobados y admins
- submenu privado LFG
- comando `/lfg`
- publicar o actualizar un anuncio propio de `Jugador busca grupo`
- publicar anuncios de `Grupo busca jugadores`
- listar jugadores buscando grupo
- listar grupos buscando jugadores
- ver anuncios propios
- editar descripcion de anuncio personal
- editar titulo, descripcion y plazas de anuncio de grupo
- marcar anuncios propios como resueltos
- cancelar anuncios propios
- persistencia en Postgres
- migracion Drizzle
- textos CA/ES/EN
- tests de dominio, store, menus y flujo Telegram basico

Fuera de v1:

- matching automatico
- filtros avanzados por juego, horario, idioma o nivel
- notificaciones automaticas a todos los socios
- gestion persistente de grupos
- invitaciones, miembros, confirmaciones cruzadas o aprobacion por terceros
- borrado fisico desde la UX
- panel web, Mini App o exportaciones

## User Experience

### Main Menu

Anadir solo una accion principal:

- `LFG`

Debe ser visible para:

- chats privados
- usuarios aprobados
- admins

No debe ser visible para:

- usuarios pendientes
- usuarios bloqueados
- grupos o canales

### LFG Submenu

El submenu debe contener:

- `Jugadores buscando grupo`
- `Grupos buscando jugadores`
- `Busco grupo`
- `Buscamos jugadores`
- `Mis anuncios`
- `Volver`

Notas:

- `Volver` debe devolver al menu principal persistente actual.
- El submenu debe usar el helper existente `buildSubmenuReplyKeyboard` si encaja.
- El flujo debe aceptar tambien `/lfg` para abrir el submenu.

### Player Ad Flow: `Busco grupo`

Objetivo: crear o actualizar el anuncio activo del usuario como jugador buscando grupo.

Pasos:

1. Usuario abre `LFG`.
2. Usuario elige `Busco grupo`.
3. Bot pide descripcion.
4. Usuario escribe una descripcion con juegos, horarios, nivel, idioma o preferencias.
5. Bot muestra resumen.
6. Usuario confirma o cancela.
7. Si el usuario ya tiene un anuncio activo de jugador, se actualiza el existente.

Resultado:

- queda un unico anuncio activo de jugador por usuario
- aparece en `Jugadores buscando grupo`

### Group Ad Flow: `Buscamos jugadores`

Objetivo: publicar un anuncio temporal para encontrar jugadores para una partida o grupo concreto.

Pasos:

1. Usuario abre `LFG`.
2. Usuario elige `Buscamos jugadores`.
3. Bot pide titulo del anuncio.
4. Bot pide descripcion.
5. Bot pide plazas disponibles, con opcion de omitir.
6. Bot muestra resumen.
7. Usuario confirma o cancela.

Ejemplos de titulo:

- `Partida de Dune Imperium este viernes`
- `Mesa de Ark Nova busca 2 personas`
- `Campana corta de rol`

Resultado:

- se crea un anuncio activo de grupo buscando jugadores
- aparece en `Grupos buscando jugadores`

### Listings

`Jugadores buscando grupo` debe listar solo anuncios `active` de jugador.

Cada entrada debe mostrar:

- nombre visible del usuario
- descripcion
- fecha corta de publicacion o actualizacion
- enlace de contacto cuando sea posible

`Grupos buscando jugadores` debe listar solo anuncios `active` de grupo.

Cada entrada debe mostrar:

- titulo
- creador
- plazas disponibles si existen
- descripcion
- fecha corta de publicacion o actualizacion
- enlace de contacto cuando sea posible

Los listados deben tener empty states claros:

- no hay jugadores buscando grupo
- no hay anuncios de grupos buscando jugadores

### My Ads

`Mis anuncios` debe mostrar los anuncios activos del usuario.

Debe incluir:

- su anuncio de jugador activo, si existe
- sus anuncios activos de grupo, si existen

Para cada anuncio propio debe ofrecer acciones inline:

- `Editar`
- `Marcar como resuelto`
- `Cancelar anuncio`

### Resolved and Cancelled Semantics

`Marcar como resuelto`:

- usar cuando el creador ya ha encontrado gente o contactos suficientes
- cambia `status` a `resolved`
- rellena `resolved_at`
- oculta el anuncio de listados activos

`Cancelar anuncio`:

- usar cuando el anuncio deja de aplicar sin haberse resuelto
- cambia `status` a `cancelled`
- rellena `cancelled_at`
- oculta el anuncio de listados activos

No hay borrado fisico en v1.

## Data Model

### Table: `lfg_player_ads`

Campos:

- `id`: bigserial primary key
- `telegram_user_id`: bigint, not null, references `users.telegram_user_id`
- `display_name`: varchar(255), not null
- `description`: text, not null
- `status`: varchar(16), not null, default `active`
- `created_at`: timestamptz, not null, default now
- `updated_at`: timestamptz, not null, default now
- `resolved_at`: timestamptz, nullable
- `cancelled_at`: timestamptz, nullable

Indices:

- lookup por `status`
- lookup por `telegram_user_id`
- lookup por `updated_at`
- unique parcial para un unico anuncio activo por usuario:
  - `uniqueIndex('lfg_player_ads_one_active_per_user').on(telegram_user_id).where(status = 'active')`

Notas:

- `display_name` se congela al publicar para que los listados no dependan de joins si el nombre cambia.
- El store puede actualizar `display_name` al actualizar el anuncio activo.

### Table: `lfg_group_ads`

Campos:

- `id`: bigserial primary key
- `created_by_telegram_user_id`: bigint, not null, references `users.telegram_user_id`
- `creator_display_name`: varchar(255), not null
- `title`: varchar(255), not null
- `description`: text, not null
- `seats_available`: integer, nullable
- `status`: varchar(16), not null, default `active`
- `created_at`: timestamptz, not null, default now
- `updated_at`: timestamptz, not null, default now
- `resolved_at`: timestamptz, nullable
- `cancelled_at`: timestamptz, nullable

Indices:

- lookup por `status`
- lookup por `created_by_telegram_user_id`
- lookup por `updated_at`

Notas:

- No hay limite de un anuncio activo de grupo por usuario.
- `seats_available` es opcional porque algunos anuncios no son por plazas exactas.

## Domain Module

Crear:

- `src/lfg/lfg-catalog.ts`
- `src/lfg/lfg-catalog-store.ts`

### Domain Types

Tipos recomendados:

```ts
export type LfgAdStatus = 'active' | 'resolved' | 'cancelled';

export interface LfgPlayerAdRecord {
  id: number;
  telegramUserId: number;
  displayName: string;
  description: string;
  status: LfgAdStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
}

export interface LfgGroupAdRecord {
  id: number;
  createdByTelegramUserId: number;
  creatorDisplayName: string;
  title: string;
  description: string;
  seatsAvailable: number | null;
  status: LfgAdStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
}
```

### Repository Contract

Metodos recomendados:

```ts
export interface LfgRepository {
  upsertActivePlayerAd(input: {
    telegramUserId: number;
    displayName: string;
    description: string;
  }): Promise<LfgPlayerAdRecord>;

  createGroupAd(input: {
    createdByTelegramUserId: number;
    creatorDisplayName: string;
    title: string;
    description: string;
    seatsAvailable: number | null;
  }): Promise<LfgGroupAdRecord>;

  updatePlayerAd(input: {
    adId: number;
    telegramUserId: number;
    description: string;
    displayName: string;
  }): Promise<LfgPlayerAdRecord>;

  updateGroupAd(input: {
    adId: number;
    actorTelegramUserId: number;
    title: string;
    description: string;
    seatsAvailable: number | null;
  }): Promise<LfgGroupAdRecord>;

  setPlayerAdStatus(input: {
    adId: number;
    actorTelegramUserId: number;
    status: 'resolved' | 'cancelled';
  }): Promise<LfgPlayerAdRecord>;

  setGroupAdStatus(input: {
    adId: number;
    actorTelegramUserId: number;
    status: 'resolved' | 'cancelled';
  }): Promise<LfgGroupAdRecord>;

  listActivePlayerAds(): Promise<LfgPlayerAdRecord[]>;
  listActiveGroupAds(): Promise<LfgGroupAdRecord[]>;
  listActiveAdsByUser(telegramUserId: number): Promise<{
    playerAds: LfgPlayerAdRecord[];
    groupAds: LfgGroupAdRecord[];
  }>;
  findPlayerAdById(adId: number): Promise<LfgPlayerAdRecord | null>;
  findGroupAdById(adId: number): Promise<LfgGroupAdRecord | null>;
}
```

### Domain Operations

Funciones recomendadas:

- `upsertLfgPlayerAd`
- `createLfgGroupAd`
- `updateLfgPlayerAd`
- `updateLfgGroupAd`
- `resolveLfgPlayerAd`
- `resolveLfgGroupAd`
- `cancelLfgPlayerAd`
- `cancelLfgGroupAd`

Validaciones:

- `telegramUserId` y `createdByTelegramUserId` deben ser enteros positivos.
- `displayName` y `creatorDisplayName` deben normalizarse y no quedar vacios.
- descripcion obligatoria:
  - trim
  - minimo 10 caracteres
  - maximo 500 caracteres
- titulo de anuncio de grupo:
  - trim
  - minimo 3 caracteres
  - maximo 120 caracteres
- plazas disponibles:
  - `null` permitido
  - si existe, entero entre 1 y 99
- solo anuncios `active` pueden editarse, resolverse o cancelarse.
- solo el propietario puede editar, resolver o cancelar en dominio base.
- admins podrian gestionarse en capa Telegram decidiendo pasar permisos especiales en una evolucion futura, pero v1 puede limitar acciones propias.

## Telegram Module Split

Crear:

- `src/telegram/lfg-flow.ts`
- `src/telegram/lfg-keyboards.ts`
- `src/telegram/lfg-presentation.ts`
- `src/telegram/i18n-lfg.ts`

### `lfg-keyboards.ts`

Responsabilidades:

- construir submenu LFG
- construir teclados de cancelar/omitir/guardar
- construir inline buttons de acciones propias

Funciones recomendadas:

- `buildLfgMenuOptions(language)`
- `buildLfgSingleCancelKeyboard()`
- `buildLfgSkipCancelKeyboard(language)`
- `buildLfgSaveOptions(language)`
- `buildLfgMyPlayerAdOptions(adId, language)`
- `buildLfgMyGroupAdOptions(adId, language)`

Callback prefixes recomendados:

```ts
export const lfgCallbackPrefixes = {
  editPlayer: 'lfg:edit_player:',
  resolvePlayer: 'lfg:resolve_player:',
  cancelPlayer: 'lfg:cancel_player:',
  editGroup: 'lfg:edit_group:',
  resolveGroup: 'lfg:resolve_group:',
  cancelGroup: 'lfg:cancel_group:',
} as const;
```

### `lfg-presentation.ts`

Responsabilidades:

- formatear listados
- formatear detalle/resumen de borradores
- escapar HTML
- generar links de contacto cuando sea posible

Funciones recomendadas:

- `formatLfgPlayerAdListMessage`
- `formatLfgGroupAdListMessage`
- `formatLfgMyAdsMessage`
- `formatLfgPlayerDraftSummary`
- `formatLfgGroupDraftSummary`
- `formatLfgPlayerAdDetail`
- `formatLfgGroupAdDetail`

Formato HTML:

- usar `escapeHtml` existente de `schedule-presentation.ts`
- usar `parseMode: 'HTML'` cuando haya enlaces o negritas
- evitar mensajes demasiado largos; si el listado crece mucho, limitar a los ultimos 20 activos en v1

Contacto:

- Si hay username disponible en runtime o join futuro, usar enlace `https://t.me/<username>`.
- Si no hay username, mostrar el nombre visible sin enlace.
- En v1 no se debe exponer el ID de Telegram como enlace de contacto.

### `i18n-lfg.ts`

Debe exponer textos CA/ES/EN para:

- labels del submenu
- prompts de flujos
- validaciones de entrada
- empty states
- confirmaciones
- estados
- labels de botones inline

Labels base:

- CA:
  - `LFG`
  - `Jugadors buscant grup`
  - `Grups buscant jugadors`
  - `Busco grup`
  - `Busquem jugadors`
  - `Els meus anuncis`
  - `Tornar`
- ES:
  - `LFG`
  - `Jugadores buscando grupo`
  - `Grupos buscando jugadores`
  - `Busco grupo`
  - `Buscamos jugadores`
  - `Mis anuncios`
  - `Volver`
- EN:
  - `LFG`
  - `Players looking for group`
  - `Groups looking for players`
  - `I am looking for a group`
  - `We are looking for players`
  - `My ads`
  - `Back`

### `lfg-flow.ts`

Responsabilidades:

- abrir submenu desde texto o comando
- gestionar sesiones de crear/editar player ad
- gestionar sesiones de crear/editar group ad
- responder callbacks de resolver/cancelar/editar
- listar anuncios activos
- listar anuncios propios

Flow keys recomendados:

- `lfg-player-ad`
- `lfg-group-ad`
- `lfg-player-edit`
- `lfg-group-edit`

Drafts recomendados:

```ts
interface LfgPlayerAdDraft {
  adId?: number;
  description?: string;
}

interface LfgGroupAdDraft {
  adId?: number;
  title?: string;
  description?: string;
  seatsAvailable?: number | null;
}
```

Funciones publicas recomendadas:

- `handleTelegramLfgCommand(context)`
- `handleTelegramLfgText(context): Promise<boolean>`
- `handleTelegramLfgCallback(context): Promise<boolean>`

## Integration

### `src/telegram/action-menu.ts`

Anadir accion:

- `id`: `lfg`
- `label`: `createTelegramI18n(language).actionMenu.lfg`
- `telemetryActionKey`: `menu.lfg`
- `uxSection`: `primary`
- `buttonRole`: `primary`
- `contexts`: `['private']`
- visible si:
  - actor aprobado
  - actor no bloqueado

Menu recomendado:

- admin:
  - mantener filas existentes y anadir `lfg` cerca de features primarias
  - ejemplo: `['group_purchases', 'lfg']`
- approved:
  - ejemplo: `['group_purchases', 'lfg']`

### `src/telegram/i18n-common.ts`

Anadir `actionMenu.lfg` para CA/ES/EN.

### `src/telegram/i18n.ts`

Importar `lfgTexts` y exponer:

- `lfg: lfgTexts[language]`

### `src/telegram/runtime-boundary-registration.ts`

Importar:

- `handleTelegramLfgCommand`
- `handleTelegramLfgText`
- `handleTelegramLfgCallback`
- `lfgCallbackPrefixes`

Registrar:

- comando `/lfg`
- callback prefixes LFG
- text handler antes de fallbacks generales y despues de language/menu translated actions

Orden recomendado en `registerTextHandlers`:

1. language
2. translated action menu
3. member debug
4. membership auto request
5. feature flows existentes
6. `handleTelegramLfgText` cerca de `group_purchases`

Cuando `handleTelegramLfgText` maneje texto, llamar `setActiveHelpSection(context, 'lfg')` si se decide extender ayuda por secciones.

### Command

Anadir:

```ts
{
  command: 'lfg',
  contexts: ['private'],
  access: 'approved',
  descriptionByLanguage: {
    ca: 'Troba grup o jugadors per jugar',
    es: 'Encuentra grupo o jugadores para jugar',
    en: 'Find a group or players to play',
  },
  handle: async (context) => {
    await handleTelegramLfgCommand(context);
  },
}
```

## Migration

Generar migracion con:

- `npm run db:generate`

Validar con:

- `npm run db:check`
- `npm run db:check:state` si aplica en el entorno local

Si la generacion automatica no queda limpia, revisar:

- `drizzle/<new_migration>.sql`
- `drizzle/meta/<new_snapshot>.json`
- `drizzle/meta/_journal.json`

## Proposed Execution Order

### Phase 1. Domain and schema foundation

Scope:

- anadir tablas LFG
- crear contrato de dominio y store
- cubrir validaciones y persistencia basica

Files to add or update:

- `src/infrastructure/database/schema.ts`
- `drizzle/<new_migration>.sql`
- `src/lfg/lfg-catalog.ts`
- `src/lfg/lfg-catalog-store.ts`
- `src/lfg/lfg-catalog.test.ts`
- `src/lfg/lfg-catalog-store.test.ts`

Implementation direction:

- definir `lfg_player_ads` y `lfg_group_ads`
- implementar tipos y operaciones de dominio
- implementar repositorio Drizzle con select builder API
- implementar unique parcial de player ad activo por usuario
- mapear fechas a ISO strings como hacen otros stores

Acceptance criteria:

- el dominio valida descripcion, titulo y plazas
- se puede publicar o actualizar un player ad activo
- se puede crear un group ad activo
- se pueden listar solo activos
- se puede resolver y cancelar
- tests de dominio y store pasan

### Phase 2. Telegram read model and submenu

Scope:

- integrar boton principal `LFG`
- abrir submenu
- listar anuncios activos y propios sin flujos de escritura completos

Files to add or update:

- `src/telegram/action-menu.ts`
- `src/telegram/i18n-common.ts`
- `src/telegram/i18n.ts`
- `src/telegram/i18n-lfg.ts`
- `src/telegram/lfg-keyboards.ts`
- `src/telegram/lfg-presentation.ts`
- `src/telegram/lfg-flow.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/action-menu.test.ts`
- `src/telegram/lfg-flow.test.ts`

Implementation direction:

- anadir action menu `lfg`
- crear submenu LFG
- implementar `/lfg`
- implementar listados `Jugadores buscando grupo`, `Grupos buscando jugadores`, `Mis anuncios`
- registrar callbacks aunque algunos se completen en fases posteriores si ayuda al routing

Acceptance criteria:

- usuario aprobado ve solo un boton nuevo `LFG` en menu principal
- `/lfg` abre submenu
- submenu muestra las acciones internas
- listados devuelven empty states cuando no hay anuncios
- listados muestran anuncios activos formateados en HTML

### Phase 3. Create and update player ad

Scope:

- implementar flujo completo `Busco grupo`
- permitir editar anuncio personal desde `Mis anuncios`

Files to add or update:

- `src/telegram/lfg-flow.ts`
- `src/telegram/lfg-keyboards.ts`
- `src/telegram/lfg-presentation.ts`
- `src/telegram/i18n-lfg.ts`
- `src/telegram/lfg-flow.test.ts`
- `src/lfg/lfg-catalog.test.ts`

Implementation direction:

- usar sesion `lfg-player-ad`
- pedir descripcion
- validar con dominio
- mostrar resumen antes de guardar
- al guardar, llamar `upsertLfgPlayerAd`
- si edita desde callback, cargar anuncio activo propio y reutilizar flujo

Acceptance criteria:

- usuario aprobado puede publicar `Busco grupo`
- si repite la accion, actualiza su anuncio activo
- puede editar desde `Mis anuncios`
- descripcion invalida devuelve mensaje claro y mantiene flujo
- cancelar limpia sesion

### Phase 4. Create and update group ad

Scope:

- implementar flujo completo `Buscamos jugadores`
- permitir editar anuncios de grupo propios desde `Mis anuncios`

Files to add or update:

- `src/telegram/lfg-flow.ts`
- `src/telegram/lfg-keyboards.ts`
- `src/telegram/lfg-presentation.ts`
- `src/telegram/i18n-lfg.ts`
- `src/telegram/lfg-flow.test.ts`
- `src/lfg/lfg-catalog.test.ts`

Implementation direction:

- usar sesion `lfg-group-ad`
- pedir titulo
- pedir descripcion
- pedir plazas disponibles u omitir
- mostrar resumen antes de guardar
- crear anuncio con `createLfgGroupAd`
- editar anuncio propio con `updateLfgGroupAd`

Acceptance criteria:

- usuario aprobado puede publicar `Buscamos jugadores`
- puede omitir plazas disponibles
- puede editar titulo, descripcion y plazas desde `Mis anuncios`
- entradas invalidas mantienen el flujo con feedback claro

### Phase 5. Resolve and cancel operations

Scope:

- completar callbacks de resolver y cancelar anuncios propios
- actualizar listados y `Mis anuncios` tras cada accion

Files to add or update:

- `src/telegram/lfg-flow.ts`
- `src/telegram/lfg-keyboards.ts`
- `src/telegram/lfg-presentation.ts`
- `src/telegram/i18n-lfg.ts`
- `src/telegram/lfg-flow.test.ts`
- `src/lfg/lfg-catalog.test.ts`

Implementation direction:

- implementar callbacks:
  - `lfg:resolve_player:<id>`
  - `lfg:cancel_player:<id>`
  - `lfg:resolve_group:<id>`
  - `lfg:cancel_group:<id>`
- validar propiedad antes de cambiar estado
- responder con confirmacion corta
- volver a mostrar `Mis anuncios`

Acceptance criteria:

- resolver oculta de listados activos
- cancelar oculta de listados activos
- no se puede resolver/cancelar anuncio ajeno
- callbacks stale no rompen el bot y devuelven mensaje controlado

### Phase 6. Polish, audit decision, and full verification

Scope:

- revisar textos
- asegurar coherencia de ayuda y telemetria
- decidir si se anaden audit events en v1
- ejecutar verificaciones completas

Files to add or update:

- `src/telegram/command-registry.test.ts` si el comando requiere cobertura adicional
- `src/telegram/action-menu.test.ts`
- `src/telegram/lfg-flow.test.ts`
- `src/lfg/*.test.ts`
- `docs/feature-status.md` si se mantiene actualizado para nuevas features

Implementation direction:

- revisar CA/ES/EN
- comprobar que `LFG` no llena el menu principal con acciones internas
- valorar audit events:
  - `lfg.player_ad.upserted`
  - `lfg.group_ad.created`
  - `lfg.ad.resolved`
  - `lfg.ad.cancelled`
- si se implementa audit, usar `appendAuditEvent` con target type estable

Acceptance criteria:

- `npm run typecheck` pasa
- tests LFG pasan
- `npm run test:unit` pasa
- `npm run db:check` pasa
- no hay cambios no relacionados

## Testing Plan

### Domain Tests

Cubrir:

- descripcion vacia o demasiado corta falla
- descripcion demasiado larga falla
- titulo de grupo vacio o demasiado largo falla
- plazas `0`, negativas o demasiado altas fallan
- player ad normaliza espacios
- group ad normaliza espacios
- resolver anuncio activo funciona
- cancelar anuncio activo funciona
- editar anuncio resuelto/cancelado falla

### Store Tests

Cubrir:

- `upsertActivePlayerAd` crea si no existe activo
- `upsertActivePlayerAd` actualiza si ya existe activo
- crear player ad tras resolver crea nuevo activo
- `createGroupAd` permite varios activos por usuario
- `listActivePlayerAds` excluye resolved/cancelled
- `listActiveGroupAds` excluye resolved/cancelled
- `listActiveAdsByUser` devuelve ambos tipos
- status operations rellenan `resolvedAt` o `cancelledAt`

### Telegram Tests

Cubrir:

- action menu muestra `LFG` para aprobado
- action menu no muestra acciones internas LFG en menu principal
- action menu no muestra `LFG` para pendiente o bloqueado
- `/lfg` abre submenu
- texto `LFG` abre submenu
- `Jugadores buscando grupo` lista empty state
- `Grupos buscando jugadores` lista empty state
- `Busco grupo` inicia flujo
- guardar player ad muestra confirmacion
- `Buscamos jugadores` inicia flujo
- guardar group ad muestra confirmacion
- `Mis anuncios` muestra acciones inline
- callback resolver cambia estado
- callback cancelar cambia estado

## Verification Commands

Ejecutar durante implementacion:

```bash
npm run typecheck
node --import tsx --test src/lfg/*.test.ts src/telegram/lfg-flow.test.ts
npm run test:unit
npm run db:generate
npm run db:check
```

Ejecutar al final:

```bash
npm run typecheck
npm run test:unit
npm run db:check
```

Si se toca migracion o estado local:

```bash
npm run db:check:state
```

## Open Decisions

Estas decisiones quedan recomendadas para v1, pero pueden ajustarse antes de implementar:

- Limite de listados: mostrar maximo 20 anuncios activos por tipo.
- Contacto sin username: mostrar solo display name, no exponer ID numerico.
- Admins: en v1 pueden ver todo como cualquier usuario aprobado, pero no gestionar anuncios ajenos salvo que se decida explicitamente.
- Audit log: recomendable para crear/resolver/cancelar, pero no estrictamente necesario para una primera version funcional.

## Implementation Notes

- Mantener nombres de DB en snake_case.
- Mantener tipos TS en camelCase.
- Usar `timestamp(..., { withTimezone: true })` como el resto del schema.
- Usar `bigint(..., { mode: 'number' })` para IDs Telegram.
- Usar `bigserial(..., { mode: 'number' })` para IDs internos.
- Ordenar listados por `updated_at desc` o `created_at desc`; elegir uno y testearlo. Recomendado: `updated_at desc`.
- Los errores de dominio deben ser mensajes tecnicos simples; la capa Telegram debe convertirlos a textos localizados cuando sea necesario.
- Evitar depender de `username` persistido para contacto hasta decidir si se hace join con `users`.
- No introducir tablas de miembros, invitaciones o matchings en v1.
