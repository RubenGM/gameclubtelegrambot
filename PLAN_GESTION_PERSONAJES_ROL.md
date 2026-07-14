# Plan de implementación: gestión de personajes de Rol

> **Para agentes de implementación:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Cada tarea debe implementarse con TDD, revisión independiente y un commit propio.

**Objetivo:** Añadir a cada partida de Rol una gestión completa de personajes y adjuntos, con propiedad transferible entre miembros confirmados, privacidad por personaje y adjunto, solicitudes de personajes libres y desasignación automática al abandonar o expulsar a un miembro.

**Arquitectura:** El dominio se separará en un catálogo de personajes y un repositorio Drizzle específico, enlazado con `role_games` y `role_game_members`. Los adjuntos reutilizarán Storage como backend interno —una entrada por adjunto dentro de la categoría oculta `role_game_handouts`—, pero sólo se gestionarán desde Rol. Telegram añadirá una sección persistente `Personajes` al panel de campaña y delegará listas, detalles, edición, adjuntos y solicitudes en un flujo dedicado.

**Tech Stack:** TypeScript, Node.js test runner, Drizzle ORM/PostgreSQL, Telegram Bot API, sesiones conversacionales existentes y Storage interno.

## Prerrequisito de ejecución

- Integrar primero la rama `codex/role-game-menu` hasta el commit `de60e11` o un descendiente que contenga el panel por secciones y la gestión endurecida de participantes.
- Ejecutar el plan desde un worktree aislado creado con `superpowers:using-git-worktrees`.
- Registrar antes de tocar código el baseline real de pruebas. A fecha 2026-07-14, las 223 pruebas de Rol + Storage están verdes y la suite global conserva fallos ajenos en Compras conjuntas, LFG, Eventos del local y un test lento de préstamos de Catálogo.

## Decisiones funcionales cerradas

- Cualquier miembro confirmado puede tener uno o más personajes en la misma partida, incluido el GM principal y los coorganizadores.
- Un miembro sin permisos de GM sólo crea personajes asignados a sí mismo.
- “GM” significa admin global, GM principal o coorganizador confirmado; se reutiliza `canManageRoleGameOperationally`.
- Un GM puede crear un personaje asignado a cualquier miembro confirmado de esa partida o dejarlo sin asignar.
- Un GM puede transferir directamente un personaje entre dos miembros confirmados mediante una sola operación atómica.
- Solicitar un personaje libre no lo asigna inmediatamente: crea una solicitud que un GM debe aprobar o rechazar.
- Aprobar una solicitud asigna el personaje de forma atómica y cancela las demás solicitudes pendientes de ese personaje.
- Cualquier miembro confirmado de la partida puede recibir o solicitar personajes.
- La propiedad sigue a `role_game_members.id`, no sólo al Telegram user ID.
- Un personaje `players` es visible para todos los miembros confirmados de la partida. Un personaje `private` sólo es visible para su jugador asignado y los GM.
- Un personaje privado sin asignar sólo es visible para GM y no puede solicitarse.
- Un adjunto `players` hereda la audiencia del personaje. Un adjunto `private` sólo es visible para el jugador asignado y los GM.
- Al abandonar un personaje o al desasignarlo un GM, el personaje queda sin asignar; no se borra.
- Promover o degradar a un miembro confirmado no modifica sus personajes.
- Al pasar un miembro confirmado a `left` o `removed`, todos sus personajes se desasignan dentro de la misma transacción que cambia su estado.
- No se añade reactivación de miembros históricos ni borrado de personajes en esta feature.
- No existe información real de personajes que migrar. La migración elimina `role_game_members.character_name` para evitar dos fuentes de verdad y conserva `role_game_members.player_note` como nota del participante.
- Los adjuntos admitidos serán documento, foto, vídeo y audio. Cada mensaje/archivo de Telegram se guarda como un adjunto independiente; no hay límite de producto y las listas se paginan.
- La URL es opcional, con máximo de 2048 caracteres y esquema exclusivo `http:` o `https:`.
- El nombre se normaliza y limita a 120 caracteres; la descripción opcional se limita a 3000.
- Todas las acciones visibles usarán teclado de respuesta persistente. Los deep links sólo abrirán detalles; no habrá nuevos botones inline bajo el mensaje.

## Restricciones globales

- Mantener `canManageRoleGame` para configuración global y `canManageRoleGameOperationally` para operaciones de GM sobre personajes.
- Revalidar permisos, estado del miembro, asignación y visibilidad inmediatamente antes de cada escritura.
- Usar compare-and-set y bloqueos `FOR UPDATE` para asignar, transferir, desasignar, aprobar solicitudes y cambiar privacidad.
- No exponer los adjuntos mediante listado, búsqueda, edición, borrado, tags o impresión genéricos de Storage.
- Mantener operativos `role_game_<id>` y `role_material_<id>`; añadir `role_character_<id>` sólo para abrir detalles.
- Localizar todos los textos en catalán, español e inglés con ortografía natural.
- Seguir `docs/telegram-pagination-style.md`: 6 elementos por página, totales recalculados, páginas acotadas, footer localizado y sólo controles válidos.
- Notificar asignaciones, aprobaciones, rechazos y desasignaciones en privado best-effort; un fallo de Telegram no revierte una escritura confirmada.
- Actualizar `docs/feature-status.md`.
- Después de cualquier cambio de código, ejecutar `./startup.sh` antes del handoff.

---

### Tarea 1: Modelo de datos, migración y contratos del dominio

**Archivos:**

- Modificar: `src/infrastructure/database/schema.ts`
- Crear: `src/role-games/role-game-character-catalog.ts`
- Crear: `src/role-games/role-game-character-catalog.test.ts`
- Generar: `drizzle/0039_*.sql`, `drizzle/meta/0039_snapshot.json` y `drizzle/meta/_journal.json`

**Produce:**

- `RoleGameCharacterRecord`
- `RoleGameCharacterAttachmentRecord`
- `RoleGameCharacterClaimRequestRecord`
- `RoleGameCharacterRepository`
- Predicados y normalizadores sin acceso a Telegram ni a la base de datos.

- [ ] **Paso 1: escribir pruebas rojas de normalización y permisos básicos**

Añadir casos que exijan nombre, validen URL, privacidad y membresía confirmada:

```ts
test('createRoleGameCharacter normalizes optional fields and assigns a player-owned character', async () => {
  const repository = createMemoryRoleGameCharacterRepository();
  const character = await createRoleGameCharacter({
    repository,
    actor: { telegramUserId: 100, isAdmin: false, isApproved: true },
    game: sampleGame(),
    actorMembership: sampleMember({ id: 5, telegramUserId: 100, role: 'player', status: 'confirmed' }),
    input: {
      roleGameId: 7,
      assignedMemberId: 5,
      name: '  Nyra  ',
      description: ' Exploradora ',
      externalUrl: 'https://example.org/nyra',
      visibility: 'players',
    },
  });
  assert.equal(character.name, 'Nyra');
  assert.equal(character.assignedMemberId, 5);
});

test('private unassigned characters are GM-only and cannot be claimed', () => {
  const character = sampleCharacter({ assignedMemberId: null, visibility: 'private' });
  assert.equal(canViewRoleGameCharacter(playerActor, game, playerMembership, character), false);
  assert.equal(canRequestRoleGameCharacter(playerActor, game, playerMembership, character), false);
});
```

- [ ] **Paso 2: ejecutar la prueba y verificar RED**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts
```

Resultado esperado: FAIL porque el módulo y sus contratos todavía no existen.

- [ ] **Paso 3: definir tipos y contratos estables**

Crear estos tipos como base del resto del plan:

```ts
export type RoleGameCharacterVisibility = 'players' | 'private';
export type RoleGameCharacterAttachmentVisibility = 'players' | 'private';
export type RoleGameCharacterClaimStatus = 'requested' | 'approved' | 'rejected' | 'cancelled';

export interface RoleGameCharacterRecord {
  id: number;
  roleGameId: number;
  assignedMemberId: number | null;
  name: string;
  description: string | null;
  externalUrl: string | null;
  visibility: RoleGameCharacterVisibility;
  createdByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  unassignedAt: string | null;
}

export interface RoleGameCharacterAttachmentRecord {
  id: number;
  characterId: number;
  internalStorageEntryId: number;
  visibility: RoleGameCharacterAttachmentVisibility;
  uploadedByTelegramUserId: number;
  createdAt: string;
  updatedAt: string;
  removedAt: string | null;
  removedByTelegramUserId: number | null;
}

export interface RoleGameCharacterClaimRequestRecord {
  id: number;
  characterId: number;
  requestedByMemberId: number;
  status: RoleGameCharacterClaimStatus;
  resolvedByTelegramUserId: number | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
```

El repositorio debe exponer `createCharacter`, `findCharacterById`, `listCharacters`, `updateCharacter`, `assignCharacter`, `transferCharacter`, `unassignCharacter`, `createAttachment`, `listAttachments`, `updateAttachmentVisibility`, `replaceAttachmentStorageEntry`, `removeAttachment`, `createClaimRequest`, `findClaimRequestById`, `listClaimRequests` y `resolveClaimRequest`.

- [ ] **Paso 4: añadir las tres tablas Drizzle**

Añadir:

- `role_game_characters`, con FK a `role_games` y FK nullable `assigned_member_id` a `role_game_members`; la FK de asignación usa `ON DELETE SET NULL` como última red de seguridad.
- `role_game_character_attachments`, con FK al personaje y FK única a `storage_entries`; el historial lógico impide borrar en cascada una entrada Storage todavía enlazada.
- `role_game_character_claim_requests`, con FK al personaje y al miembro solicitante.

Eliminar también `role_game_members.character_name` en esta migración, sin backfill. Mantener `player_note` sin cambios.

Índices obligatorios:

- personajes por `role_game_id`, `assigned_member_id` y `visibility`;
- adjuntos por `character_id`, índice único por `internal_storage_entry_id` y filtro de activos por `removed_at`;
- solicitudes por `character_id`, `requested_by_member_id`, `status` y único parcial para `character_id + requested_by_member_id` cuando `status = 'requested'`.

- [ ] **Paso 5: generar y comprobar la migración**

```bash
npm run db:generate
npm run db:check
```

Resultado esperado: se genera exactamente la migración `0039`, su snapshot y la entrada de journal; `db:check` termina con código 0.

- [ ] **Paso 6: completar normalizadores y predicados puros**

Implementar:

```ts
export function canViewRoleGameCharacter(
  actor: RoleGameActor,
  game: RoleGameRecord,
  actorMembership: RoleGameMemberRecord | null,
  character: RoleGameCharacterRecord,
): boolean;

export function canEditRoleGameCharacter(...): boolean;
export function canRequestRoleGameCharacter(...): boolean;
export function canViewRoleGameCharacterAttachment(...): boolean;
```

Los predicados deben aplicar literalmente las decisiones funcionales de este documento.

- [ ] **Paso 7: ejecutar pruebas y commit**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts
npm run typecheck
git add src/infrastructure/database/schema.ts src/role-games/role-game-character-catalog.ts src/role-games/role-game-character-catalog.test.ts drizzle
git commit -m "feat: add role game character model"
```

---

### Tarea 2: Repositorio Drizzle y transiciones atómicas

**Archivos:**

- Crear: `src/role-games/role-game-character-store.ts`
- Crear: `src/role-games/role-game-character-store.test.ts`
- Modificar: `src/role-games/role-game-character-catalog.ts`
- Modificar: `src/role-games/role-game-character-catalog.test.ts`

**Consume:** Las tablas y contratos de la Tarea 1.

**Produce:** Persistencia real y funciones de dominio para crear, editar, asignar, abandonar, desasignar y solicitar personajes.

- [ ] **Paso 1: escribir pruebas rojas de asignación y solicitudes**

Cubrir:

- jugador crea personaje propio;
- GM crea asignado o sin asignar;
- no se asigna a miembro de otra partida, histórico o no confirmado;
- GM principal y coorganizadores confirmados pueden recibir y conservar personajes;
- transferencia directa cambia de propietario sin estado libre intermedio y cancela solicitudes incompatibles;
- aprobación bloquea personaje y solicitante, asigna una sola vez y cancela solicitudes rivales;
- dos aprobaciones concurrentes no pueden producir doble dueño;
- jugador abandona sólo su personaje;
- GM desasigna cualquier personaje de su partida;
- personaje privado o ya asignado no admite solicitud.

```ts
test('approving a claim atomically assigns the free character and cancels rival requests', async () => {
  const approved = await approveRoleGameCharacterClaim({
    repository,
    actor: gmActor,
    game,
    actorMembership: gmMembership,
    requestId: firstRequest.id,
  });
  assert.equal(approved.character.assignedMemberId, firstRequest.requestedByMemberId);
  assert.equal(approved.request.status, 'approved');
  assert.equal((await repository.findClaimRequestById(secondRequest.id))?.status, 'cancelled');
});
```

- [ ] **Paso 2: verificar RED**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.test.ts
```

Resultado esperado: FAIL por repositorio y operaciones ausentes.

- [ ] **Paso 3: implementar lecturas simples con query builder**

Usar exclusivamente `db.select()`, joins explícitos y consultas separadas para relaciones uno-a-muchos. No usar `db.query.*`.

Orden de listas:

- propios: `updated_at DESC, id DESC`;
- campaña: nombre normalizado ASC, id ASC;
- libres: `created_at ASC, id ASC`;
- solicitudes: `created_at ASC, id ASC`.

- [ ] **Paso 4: implementar escrituras con bloqueos y compare-and-set**

`assignCharacter`, `unassignCharacter` y `resolveClaimRequest` deben:

1. abrir transacción;
2. bloquear personaje;
3. bloquear miembro o solicitud implicados;
4. recargar el estado actual;
5. comprobar partida, rol, estado, visibilidad y asignación;
6. escribir con predicados de estado esperado;
7. cancelar solicitudes incompatibles en la misma transacción.

Una asignación directa de GM y una aprobación de solicitud deben compartir una función privada del store para evitar reglas divergentes.
`transferCharacter` debe usar esa misma primitiva, exigir propietario esperado y cambiar de A a B sin dejar el personaje libre entre escrituras.

- [ ] **Paso 5: implementar API de dominio**

Añadir:

```ts
createRoleGameCharacter(...)
updateRoleGameCharacter(...)
assignRoleGameCharacter(...)
transferRoleGameCharacter(...)
abandonRoleGameCharacter(...)
unassignRoleGameCharacter(...)
requestRoleGameCharacter(...)
cancelRoleGameCharacterRequest(...)
approveRoleGameCharacterClaim(...)
rejectRoleGameCharacterClaim(...)
```

Cada función recibe explícitamente `roleGameRepository` y `characterRepository`, y recarga personaje, juego y membresías relevantes antes de delegar la transición. El repositorio de personajes no duplicará lecturas generales de partidas o participantes.

- [ ] **Paso 6: ejecutar pruebas y commit**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.test.ts
npm run typecheck
git add src/role-games/role-game-character-catalog.ts src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.ts src/role-games/role-game-character-store.test.ts
git commit -m "feat: manage role game character ownership"
```

---

### Tarea 3: Desasignación automática al salir o expulsar miembros

**Archivos:**

- Modificar: `src/role-games/role-game-catalog-store.ts`
- Modificar: `src/role-games/role-game-catalog-store.test.ts`
- Modificar fakes: `src/role-games/role-game-catalog.test.ts`, `src/telegram/role-game-flow.test.ts`

**Consume:** `role_game_characters.assigned_member_id`.

**Produce:** Garantía transaccional de que ningún personaje queda asignado a un miembro histórico y de que los cambios de rol conservan la propiedad.

- [ ] **Paso 1: escribir pruebas rojas del ciclo del participante**

```ts
test('removing a confirmed player unassigns every character in the same transaction', async () => {
  const updated = await repository.setMemberStatus({
    memberId: player.id,
    status: 'removed',
    expectedStatus: 'confirmed',
    expectedRole: 'player',
    actorTelegramUserId: 42,
  });
  assert.equal(updated.status, 'removed');
  assert.deepEqual(
    (await characterRepository.listCharacters(game.id)).map((character) => character.assignedMemberId),
    [null, null],
  );
});
```

Repetir para `left`. Verificar que `rejected` sobre una solicitud sin personajes no modifica otras asignaciones, que un fallo de compare-and-set no desasigna nada y que promover o degradar a un miembro confirmado conserva todos sus personajes.

- [ ] **Paso 2: verificar RED**

```bash
node --import tsx --test src/role-games/role-game-catalog-store.test.ts
```

- [ ] **Paso 3: ampliar `setMemberStatus`**

Convertir la transición en una transacción que bloquea el miembro, valida estado/rol esperado, pone `assigned_member_id = null`, `unassigned_at = now()` y `updated_at = now()` para todos sus personajes, y finalmente cambia el estado del miembro. Sólo se ejecuta al pasar un miembro confirmado a `left` o `removed`; `setMemberRole` no toca personajes.

- [ ] **Paso 4: ejecutar regresión y commit**

```bash
node --import tsx --test src/role-games/role-game-catalog-store.test.ts src/role-games/role-game-catalog.test.ts src/telegram/role-game-flow.test.ts
git add src/role-games/role-game-catalog-store.ts src/role-games/role-game-catalog-store.test.ts src/role-games/role-game-catalog.test.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: unassign characters when players leave"
```

---

### Tarea 4: Adjuntos privados respaldados por Storage

**Archivos:**

- Modificar: `src/role-games/role-game-character-catalog.ts`
- Modificar: `src/role-games/role-game-character-store.ts`
- Modificar pruebas de ambos módulos
- Modificar: `src/storage/storage-internal-purpose.test.ts`
- Modificar: `src/storage/storage-flow.test.ts`

**Consume:** Categoría interna existente con `categoryPurpose = 'role_game_handouts'` y `StorageCategoryRepository.createEntry`.

**Produce:** Añadir, listar, cambiar privacidad, reemplazar y retirar adjuntos sin exponerlos en Storage genérico.

- [ ] **Paso 1: escribir pruebas rojas de adjuntos**

Cubrir:

- propietario y GM añaden adjuntos;
- otro jugador no puede añadir, reemplazar ni retirar;
- adjunto privado queda oculto para otros jugadores;
- cambiar privacidad usa estado esperado;
- reemplazo conserva el ID lógico del adjunto, cambia `internalStorageEntryId` y retira la entrada anterior mediante la orquestación de Rol;
- retirada rellena `removedAt` y oculta la entrada;
- un personaje abandonado sólo puede ser gestionado por GM;
- callbacks genéricos de Storage rechazan entrada de personaje igual que un handout.

- [ ] **Paso 2: verificar RED**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.test.ts src/telegram/storage-flow.test.ts
```

- [ ] **Paso 3: implementar operaciones de adjunto**

La creación debe recibir una entrada de Storage ya persistida:

```ts
addRoleGameCharacterAttachment({
  repository,
  actor,
  game,
  actorMembership,
  character,
  internalStorageEntryId,
  visibility,
}): Promise<RoleGameCharacterAttachmentRecord>
```

`replaceAttachmentStorageEntry` y `removeAttachment` deben comprobar `expectedInternalStorageEntryId` o `expectedRemovedAt = null` para evitar acciones obsoletas. El repositorio de personajes sólo cambia el enlace o el estado lógico del adjunto; no debe fingir una transacción distribuida con Storage.

La capa de dominio orquesta ambos repositorios con compensación explícita:

1. persistir la nueva entrada Storage;
2. intercambiar el enlace del adjunto mediante compare-and-set;
3. retirar best-effort la entrada Storage anterior después del intercambio confirmado;
4. si el intercambio falla, retirar la entrada nueva para no dejar huérfanos;
5. registrar cualquier fallo de limpieza para reintento, sin afirmar al usuario que el reemplazo falló cuando el nuevo enlace ya quedó confirmado.

Al retirar un adjunto, marcar primero `removedAt` en Rol y después retirar best-effort la entrada Storage. Las lecturas se rigen siempre por el estado de Rol, de modo que un fallo de limpieza no vuelve a hacer visible el adjunto.

- [ ] **Paso 4: endurecer la frontera genérica de Storage**

No se añade una categoría visible nueva. Los adjuntos se guardan en la categoría interna de Rol existente y quedan bloqueados por `isUserVisibleStorageCategoryPurpose`. Añadir pruebas explícitas para búsqueda, detalle directo, editar, borrar, tags e imprimir usando una entrada enlazada a `role_game_character_attachments`.

- [ ] **Paso 5: ejecutar pruebas y commit**

```bash
node --import tsx --test src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.test.ts src/telegram/storage-flow.test.ts src/storage/storage-internal-purpose.test.ts
git add src/role-games/role-game-character-catalog.ts src/role-games/role-game-character-catalog.test.ts src/role-games/role-game-character-store.ts src/role-games/role-game-character-store.test.ts src/storage/storage-internal-purpose.test.ts src/telegram/storage-flow.test.ts
git commit -m "feat: add private role game character attachments"
```

---

### Tarea 5: Navegación de Personajes, listas y detalles

**Archivos:**

- Crear: `src/telegram/role-game-character-flow.ts`
- Crear: `src/telegram/role-game-character-flow.test.ts`
- Crear: `src/telegram/role-game-character-keyboards.ts`
- Modificar: `src/telegram/role-game-flow.ts`
- Modificar: `src/telegram/role-game-flow.test.ts`
- Modificar: `src/telegram/role-game-keyboards.ts`
- Modificar: `src/telegram/i18n-role-games.ts`

**Produce:** Sección persistente `Personajes`, paginación y deep link `role_character_<id>`.

- [ ] **Paso 1: escribir pruebas rojas de navegación y visibilidad**

Probar panel de campaña para GM, miembro confirmado sin permisos de GM, visitante y miembro histórico. La sección debe mostrar:

- `Mis personajes`;
- `Personajes de la campaña`;
- `Personajes sin asignar`;
- `Crear personaje`;
- para GM, además `Solicitudes de personaje` y `Asignar personaje`.

Las listas deben filtrar personajes y adjuntos privados antes de paginar.

- [ ] **Paso 2: verificar RED**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts src/telegram/role-game-flow.test.ts
```

- [ ] **Paso 3: añadir `Personajes` al panel de campaña**

Ampliar `RoleGameDetailSessionData.view` con `characters` y delegar el texto del botón al módulo nuevo. El botón se muestra a miembros confirmados y GM; no a visitantes, pendientes ni miembros históricos.

- [ ] **Paso 4: implementar sesión y paginación**

Usar:

```ts
interface RoleGameCharacterSessionData {
  gameId: number;
  view: 'menu' | 'mine' | 'campaign' | 'unassigned' | 'detail' | 'claims' | 'attachments';
  page: number;
  total: number;
  characterButtons: Record<string, number>;
  attachmentButtons: Record<string, number>;
  selectedCharacterId?: number;
}
```

Los mapas de botones deben ser session-safe y rechazar texto fabricado. Los nombres duplicados se desambiguan con `· #ID`.

- [ ] **Paso 5: implementar mensajes de detalle**

Mostrar nombre, descripción, URL segura, privacidad, jugador asignado o `Sin asignar`, creador, fecha y recuento de adjuntos visibles. Las acciones dependen de permisos y estado actual, nunca sólo de la sesión.

- [ ] **Paso 6: añadir deep link de lectura**

`role_character_<id>` abre el mismo detalle después de recargar juego, membresía, personaje y permisos. Un enlace privado o de otra partida responde con mensaje seguro sin filtrar nombre ni existencia.

- [ ] **Paso 7: ejecutar pruebas y commit**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts src/telegram/role-game-flow.test.ts
npm run typecheck
git add src/telegram/role-game-character-flow.ts src/telegram/role-game-character-flow.test.ts src/telegram/role-game-character-keyboards.ts src/telegram/role-game-flow.ts src/telegram/role-game-flow.test.ts src/telegram/role-game-keyboards.ts src/telegram/i18n-role-games.ts
git commit -m "feat: add role game character section"
```

---

### Tarea 6: Creación, edición y gestión de adjuntos en Telegram

**Archivos:**

- Modificar: `src/telegram/role-game-character-flow.ts`
- Modificar: `src/telegram/role-game-character-flow.test.ts`
- Modificar: `src/telegram/role-game-character-keyboards.ts`
- Modificar: `src/telegram/i18n-role-games.ts`

**Produce:** Wizards completos para jugador y GM, edición de campos y ciclo de adjuntos.

- [ ] **Paso 1: escribir pruebas rojas de creación**

Cubrir:

- jugador: nombre → descripción/omitir → URL/omitir → privacidad → confirmar;
- GM: asignar a cualquier miembro confirmado o dejar libre → mismos campos → confirmar;
- URL inválida conserva el paso y teclado;
- cancelar no deja personaje ni teclado huérfano;
- GM no puede asignar a miembro histórico o de otra partida.

- [ ] **Paso 2: verificar RED**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts
```

- [ ] **Paso 3: implementar los drafts**

```ts
interface RoleGameCharacterDraft {
  gameId: number;
  assignedMemberId: number | null;
  name?: string;
  description?: string | null;
  externalUrl?: string | null;
  visibility?: 'players' | 'private';
}
```

La selección GM de miembro debe usar botones session-safe y paginación, no Telegram IDs escritos a mano.

- [ ] **Paso 4: escribir pruebas rojas de edición**

Probar edición independiente de nombre, descripción, URL y privacidad; cambio de privacidad sobre estado obsoleto; pérdida de propiedad mientras el wizard está abierto; y acceso de GM.

- [ ] **Paso 5: implementar edición con confirmación**

Cada edición recarga el personaje y vuelve a comprobar `canEditRoleGameCharacter`. Los valores vacíos sólo eliminan descripción o URL cuando el usuario pulsa la opción localizada explícita.

- [ ] **Paso 6: escribir pruebas rojas del upload múltiple**

Probar documento, foto, vídeo y audio; adjuntos ilimitados uno a uno; privacidad elegida para cada adjunto; terminar sin adjuntos; reemplazo; retirada; navegación paginada; fallo de copia a Storage y recuperación local.

- [ ] **Paso 7: implementar el flujo de adjuntos**

Patrón:

1. usuario pulsa `Añadir adjunto`;
2. el bot pide archivo;
3. copia el mensaje a la categoría interna de Rol;
4. crea una entrada Storage de un solo mensaje;
5. pregunta `Visible para jugadores` o `Privado`;
6. enlaza la entrada al personaje;
7. vuelve al detalle y permite añadir otro.

Para reemplazar, completar primero la nueva copia y sólo después intercambiar el enlace. Si falla, conservar el adjunto anterior.

- [ ] **Paso 8: ejecutar pruebas y commit**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts src/telegram/storage-flow.test.ts
npm run typecheck
git add src/telegram/role-game-character-flow.ts src/telegram/role-game-character-flow.test.ts src/telegram/role-game-character-keyboards.ts src/telegram/i18n-role-games.ts
git commit -m "feat: create and edit role game characters"
```

---

### Tarea 7: Solicitudes, asignación, abandono y notificaciones

**Archivos:**

- Modificar: `src/telegram/role-game-character-flow.ts`
- Modificar: `src/telegram/role-game-character-flow.test.ts`
- Modificar: `src/telegram/role-game-character-keyboards.ts`
- Modificar: `src/telegram/i18n-role-games.ts`
- Modificar: `src/telegram/role-game-flow.test.ts`

**Produce:** Flujos finales de transferencia de personajes y recepción best-effort.

- [ ] **Paso 1: escribir pruebas rojas de solicitud y resolución**

Cubrir:

- jugador solicita personaje público libre;
- no puede duplicar solicitud;
- puede cancelar la propia;
- GM lista solicitudes, abre detalle, aprueba o rechaza con confirmación;
- aprobación asigna y notifica;
- rechazo notifica;
- dos aprobaciones obsoletas recuperan lista sin doble asignación;
- personaje privado o ya asignado desaparece de la lista antes de solicitar.
- GM transfiere directamente entre miembros confirmados y notifica a propietario anterior y nuevo;

- [ ] **Paso 2: escribir pruebas rojas de abandono y desasignación**

Cubrir:

- propietario abandona con confirmación;
- otro jugador no puede;
- GM desasigna sin cambiar `role_game_members.status`;
- expulsión desde Participantes desasigna y notifica;
- fallo de notificación no revierte;
- el jugador anterior pierde inmediatamente edición y adjuntos privados.

- [ ] **Paso 3: verificar RED**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts src/telegram/role-game-flow.test.ts
```

- [ ] **Paso 4: implementar confirmaciones y recuperación obsoleta**

Guardar en sesión ID de solicitud/personaje, acción y estado esperado. Limpiar la acción pendiente inmediatamente después de persistir y antes de reconstruir listas. Errores de stale, permisos o personaje ya asignado deben volver a la vista correcta con explicación localizada.

- [ ] **Paso 5: implementar notificaciones best-effort**

Notificar:

- solicitud creada al GM principal;
- aprobada/rechazada al solicitante;
- asignación directa al miembro;
- transferencia directa al propietario anterior y al nuevo;
- abandono/desasignación al miembro afectado;
- expulsión con desasignación indicando que el personaje queda disponible sólo si es público.

Registrar fallos con `logger.warn` estructurado y continuar.

- [ ] **Paso 6: ejecutar pruebas y commit**

```bash
node --import tsx --test src/telegram/role-game-character-flow.test.ts src/telegram/role-game-flow.test.ts
npm run typecheck
git add src/telegram/role-game-character-flow.ts src/telegram/role-game-character-flow.test.ts src/telegram/role-game-character-keyboards.ts src/telegram/i18n-role-games.ts src/telegram/role-game-flow.test.ts
git commit -m "feat: transfer role game characters"
```

---

### Tarea 8: Documentación, regresión completa y despliegue

**Archivos:**

- Modificar: `docs/feature-status.md`
- Revisar: todos los archivos de las tareas anteriores

- [ ] **Paso 1: actualizar el inventario**

Documentar:

- personajes múltiples para cualquier miembro confirmado;
- privacidad completa y por adjunto;
- creación por miembros y GM;
- personajes libres y solicitudes;
- abandono, asignación y desasignación;
- desasignación automática al salir o ser expulsado;
- Storage interno y frontera genérica;
- permisos de GM principal/coorganizador/admin y propiedad permitida para cualquier rol confirmado;
- pruebas y riesgos operativos.

Mantener la tabla de resumen ejecutivo como bloque de texto de ancho fijo.

- [ ] **Paso 2: ejecutar la suite objetivo**

```bash
node --import tsx --test \
  src/role-games/role-game-catalog.test.ts \
  src/role-games/role-game-catalog-store.test.ts \
  src/role-games/role-game-character-catalog.test.ts \
  src/role-games/role-game-character-store.test.ts \
  src/role-games/role-game-scheduler.test.ts \
  src/telegram/role-game-flow.test.ts \
  src/telegram/role-game-character-flow.test.ts \
  src/telegram/storage-flow.test.ts \
  src/storage/storage-internal-purpose.test.ts
```

Resultado esperado: 0 fallos.

- [ ] **Paso 3: validar esquema, tipado e inventario**

```bash
npm run db:check
npm run typecheck
./scripts/feature-status-audit.sh
git diff --check
```

Resultado esperado: todos los comandos terminan con código 0.

- [ ] **Paso 4: ejecutar suite global y comparar baseline**

```bash
timeout 900s npm test
```

Si siguen existiendo fallos ajenos registrados en el baseline, verificar individualmente que no se han añadido fallos ni modificado esos módulos. No corregir deuda externa dentro de esta feature sin autorización.

- [ ] **Paso 5: revisión final independiente**

Solicitar revisión de todo el rango de commits contra este plan. Corregir cualquier hallazgo Critical o Important y repetir las validaciones afectadas.

- [ ] **Paso 6: desplegar y comprobar runtime**

```bash
./startup.sh
systemctl is-active gameclubtelegrambot.service
curl -fsS http://127.0.0.1:8787/
./scripts/service-journal.sh -n 120
```

Resultado esperado: startup completo, servicio `active`, HTTP 200 y journal con PostgreSQL, Telegram y Admin HTTP iniciados.

- [ ] **Paso 7: commit documental final**

```bash
git add docs/feature-status.md
git commit -m "docs: record role game character management"
```

## Criterios de aceptación

- Cualquier miembro confirmado puede crear y mantener varios personajes propios.
- Cada personaje admite nombre, descripción opcional, URL opcional y cualquier número de adjuntos.
- El propietario y los GM pueden añadir, reemplazar, retirar y cambiar la privacidad de cada adjunto.
- Los miembros confirmados ven personajes y adjuntos públicos de los demás, pero nunca contenido privado ajeno.
- Los GM crean personajes asignados o libres y pueden asignar, transferir y desasignar sin modificar la membresía.
- Los jugadores solicitan personajes libres; la asignación sólo ocurre tras aprobación de GM.
- Abandonar, salir o ser expulsado desasigna sin borrar; promover o degradar conserva la propiedad.
- Las transiciones concurrentes no generan doble propietario ni recibos falsos.
- Los adjuntos internos no aparecen ni se pueden manipular desde Storage genérico.
- Toda la UX usa teclados persistentes, está localizada y conserva compatibilidad con el panel actual de Rol.
