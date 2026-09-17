# Plan de Implementación: Gestión de Acompañantes y Espectadores en la Agenda

> **Guía para agentes:** Sigue estrictamente la disciplina TDD (**rojo -> verde -> refactor**). Ningún código de producción debe escribirse sin un test previo que falle por la razón correcta.

**Objetivo:** Permitir que los socios se inscriban a actividades como Jugadores (consumen plaza) o como Espectadores/Acompañantes (no consumen plaza), así como añadir acompañantes (+X) a su inscripción sin alterar el aforo de la partida.

**Diseño de referencia:** `docs/superpowers/specs/2026-09-17-schedule-companions-design.md`

---

### Tarea 1: Esquema de Base de Datos y Migración Drizzle

**Archivos involucrados:**
- Modificar: `src/infrastructure/database/schema.ts`
- Modificar: `src/scripts/generate-checked-migration.ts` / ejecutar migración
- Ejecutar: `npm run db:generate` y `npm run db:migrate` (o `./startup.sh`)

- [ ] **Paso 1.1: Añadir columnas `participationRole` y `guestCount` a `scheduleEventParticipants`**
  En `src/infrastructure/database/schema.ts`:
  - `participationRole: varchar('participation_role', { length: 16 }).notNull().default('player')`
  - `guestCount: integer('guest_count').notNull().default(0)`
  - Añadir check de no negatividad: `check('schedule_event_participants_guest_count_non_negative', sql`${table.guestCount} >= 0`)`

- [ ] **Paso 1.2: Generar y verificar la migración Drizzle**
  Ejecutar:
  ```bash
  npm run db:generate
  ```
  Verificar que se genera el archivo `.sql` correspondiente en `drizzle/` y los metadatos en `drizzle/meta/`.

- [ ] **Paso 1.3: Aplicar migración en la base de datos de desarrollo**
  Ejecutar:
  ```bash
  npm run db:migrate
  ```

---

### Tarea 2: Dominio de Agenda y Aforo (`schedule-catalog`)

**Archivos involucrados:**
- Modificar: `src/schedule/schedule-catalog.ts`
- Modificar: `src/schedule/schedule-catalog.test.ts`

- [ ] **Paso 2.1: Escribir tests que fallen (ROJO) para cálculo de aforo y roles**
  En `src/schedule/schedule-catalog.test.ts`, añadir pruebas unitarias:
  - `joinScheduleEvent` con `role: 'spectator'` no reduce `availableSeats`.
  - `joinScheduleEvent` con `role: 'spectator'` se permite incluso si `availableSeats === 0`.
  - `joinScheduleEvent` con `role: 'player'` falla con error específico si `availableSeats === 0`.
  - `setScheduleEventParticipantRole`: cambiar de `spectator` a `player` consume 1 plaza si hay sitio, o falla si `isFull`.
  - `setScheduleEventParticipantRole`: cambiar de `player` a `spectator` libera 1 plaza.
  - `setScheduleEventParticipantGuests`: actualiza `guestCount` sin alterar `occupiedSeats` ni `availableSeats`.
  - `leaveScheduleEvent`: marca al participante como inactivo y restablece `guestCount` a `0`.

- [ ] **Paso 2.2: Ejecutar test en rojo**
  Ejecutar:
  ```bash
  node --import tsx --test src/schedule/schedule-catalog.test.ts
  ```
  Verificar que los nuevos tests fallan por ausencia de tipos o implementación.

- [ ] **Paso 2.3: Implementar la lógica en `src/schedule/schedule-catalog.ts` (VERDE)**
  - Actualizar `ScheduleParticipantRecord` y `ScheduleParticipationRole = 'player' | 'spectator'`.
  - Modificar `getScheduleCapacitySnapshot`: solo contar participantes activos con `participationRole === 'player'`.
  - Actualizar `joinScheduleEvent` para admitir `role?: ScheduleParticipationRole` (por defecto `'player'`).
  - Implementar funciones de dominio:
    - `setScheduleEventParticipantRole({ repository, eventId, participantTelegramUserId, actorTelegramUserId, role })`
    - `setScheduleEventParticipantGuests({ repository, eventId, participantTelegramUserId, actorTelegramUserId, guestCount })`

- [ ] **Paso 2.4: Verificar verde**
  Ejecutar:
  ```bash
  node --import tsx --test src/schedule/schedule-catalog.test.ts
  ```
  Asegurar que todos los tests pasan correctamente.

---

### Tarea 3: Persistencia en Repositorio (`schedule-catalog-store`)

**Archivos involucrados:**
- Modificar: `src/schedule/schedule-catalog-store.ts`
- Modificar: `src/schedule/schedule-catalog-store.test.ts`

- [ ] **Paso 3.1: Escribir tests en rojo para persistencia de roles y acompañantes**
  En `src/schedule/schedule-catalog-store.test.ts`:
  - Verificar inserción y lectura de `participationRole` y `guestCount`.
  - Verificar actualización de `participationRole` y de `guestCount` vía `upsertParticipant` o métodos dedicados.

- [ ] **Paso 3.2: Ejecutar test en rojo**
  Ejecutar:
  ```bash
  node --import tsx --test src/schedule/schedule-catalog-store.test.ts
  ```

- [ ] **Paso 3.3: Implementar persistencia en `src/schedule/schedule-catalog-store.ts` (VERDE)**
  - Mapear las columnas `participationRole` y `guestCount` en queries `SELECT`, `INSERT` y `UPDATE` de `scheduleEventParticipants`.

- [ ] **Paso 3.4: Verificar verde**
  Ejecutar:
  ```bash
  node --import tsx --test src/schedule/schedule-catalog-store.test.ts
  ```

---

### Tarea 4: Textos, i18n y Presentación de Ficha (`schedule-presentation`)

**Archivos involucrados:**
- Modificar: `src/telegram/i18n-schedule.ts`
- Modificar: `src/telegram/schedule-presentation.ts`
- Modificar: `src/telegram/schedule-presentation.test.ts`
- Modificar: `src/telegram/schedule-flow-support.ts` (en `formatScheduleEventView`)

- [ ] **Paso 4.1: Añadir textos i18n en CA, ES y EN**
  En `src/telegram/i18n-schedule.ts`:
  - `joinAsPlayer`: "🎮 Apuntarme a jugar" / "🎮 Apuntar-me a jugar" / "🎮 Join to play"
  - `joinAsSpectator`: "👀 Apuntarme de espectador" / "👀 Apuntar-me d'espectador" / "👀 Join as spectator"
  - `joinAsSpectatorFull`: "👀 Apuntarme de espectador (mesa llena)" / "👀 Apuntar-me d'espectador (taula plena)" / "👀 Join as spectator (table full)"
  - `manageGuestsButton`: "👥 Acompañantes (+{count})" / "👥 Acompanyants (+{count})" / "👥 Companions (+{count})"
  - `switchToSpectator`: "👀 Pasar a espectador" / "👀 Passar a espectador" / "👀 Switch to spectator"
  - `switchToPlayer`: "🎮 Pasar a jugar" / "🎮 Passar a jugar" / "🎮 Switch to player"
  - `detailsPlayers`: "Jugadores" / "Jugadors" / "Players"
  - `detailsSpectators`: "Acompañantes / Espectadores" / "Acompanyants / Espectadors" / "Companions / Spectators"
  - `guestCountTag`: "+{count} acompañante" / "+{count} acompanyant" (con plural)
  - `guestPrompt`: "¿Cuántos acompañantes vendrán contigo a ver la actividad?\nActualmente tienes: {count} acompañante(s)."
  - `guestZeroButton`: "0 acompañantes" / "0 acompanyants" / "0 companions"
  - `backToActivity`: "« Volver a la actividad" / "« Tornar a l'activitat" / "« Back to activity"

- [ ] **Paso 4.2: Escribir tests en rojo para `formatScheduleEventView` y desglose de asistentes**
  En `src/telegram/schedule-presentation.test.ts`:
  - Test de renderizado de lista con jugadores, plazas reservadas y bloque diferenciado de espectadores con acompañantes.
  - Test de omisión del bloque de espectadores si no hay ninguno.

- [ ] **Paso 4.3: Implementar formateo en `formatScheduleEventView` (VERDE)**
  - Desglosar la lista de participantes cargando su `participationRole` y `guestCount`.
  - Agrupar jugadores y espectadores con formato HTML limpio.

- [ ] **Paso 4.4: Verificar verde**
  Ejecutar:
  ```bash
  node --import tsx --test src/telegram/schedule-presentation.test.ts
  ```

---

### Tarea 5: Teclados Inline y Botones de Acción

**Archivos involucrados:**
- Modificar: `src/telegram/schedule-flow-support.ts`
- Modificar: `src/telegram/schedule-flow.test.ts`

- [ ] **Paso 5.1: Escribir tests en rojo para las opciones inline de actividad**
  En `src/telegram/schedule-flow.test.ts`:
  - Usuario no inscrito con plazas libres: recibe botones de Jugar y de Espectador.
  - Usuario no inscrito con mesa llena: recibe únicamente botón de Espectador.
  - Usuario ya inscrito: recibe botón `👥 Acompañantes (+X)`, botón de alternar rol y botón de desapuntarse.

- [ ] **Paso 5.2: Actualizar generadores de teclado en `schedule-flow-support.ts` (VERDE)**
  - Adaptar `buildScheduleDetailActionOptions` para inyectar los nuevos botones contextuales y prefijos callback.

- [ ] **Paso 5.3: Verificar verde**
  Ejecutar:
  ```bash
  node --import tsx --test src/telegram/schedule-flow.test.ts
  ```

---

### Tarea 6: Handlers y Subflujo de Callbacks en Telegram

**Archivos involucrados:**
- Modificar: `src/telegram/schedule-flow-support.ts`
- Modificar: `src/telegram/schedule-flow.test.ts`

- [ ] **Paso 6.1: Escribir tests en rojo para callbacks de interacción**
  En `src/telegram/schedule-flow.test.ts`:
  - Callback de inscripción como espectador (`schedule_act:join_spectator:<id>`).
  - Callback de cambio a espectador (`schedule_act:switch_spectator:<id>`).
  - Callback de cambio a jugador (`schedule_act:switch_player:<id>`) con éxito y cuando la mesa está llena.
  - Callback de apertura de menú de acompañantes (`schedule_act:guests:<id>`).
  - Callbacks de delta de acompañantes (`schedule_act:guest_delta:<id>:+1`, `-1`, `0`).

- [ ] **Paso 6.2: Implementar los callbacks en `schedule-flow-support.ts` (VERDE)**
  - Añadir soporte a los prefijos de callback en el despachador de eventos de agenda.
  - Asegurar edición interactiva en el mensaje inline para subida/bajada de acompañantes.
  - Gestionar concurrencia y errores amigables.

- [ ] **Paso 6.3: Verificar verde**
  Ejecutar:
  ```bash
  node --import tsx --test src/telegram/schedule-flow.test.ts
  ```

---

### Tarea 7: Integraciones Secundarias (Google Calendar y Panel Web)

**Archivos involucrados:**
- Modificar: `src/schedule/schedule-google-calendar-sync.ts` (o archivo correspondiente)
- Modificar: `src/http/admin-http-server.ts`
- Modificar: `src/http/admin-http-server.test.ts`

- [ ] **Paso 7.1: Escribir test y adaptar sincronización de Google Calendar**
  - Asegurar que la descripción del evento incluya el desglose de espectadores/acompañantes sin romper el enlace de sincronización.

- [ ] **Paso 7.2: Verificar y ajustar vistas del panel web**
  - Comprobar que `/actividades` y `/admin/activities` muestren la capacidad sin alteraciones.
  - Ejecutar:
    ```bash
    node --import tsx --test src/http/admin-http-server.test.ts
    ```

---

### Tarea 8: Verificación Completa, Auditoría y Despliegue en Vivo

**Archivos involucrados:**
- Modificar: `docs/feature-status.md`
- Ejecutar: `npm run typecheck`
- Ejecutar: `npm test`
- Ejecutar: `./scripts/feature-status-audit.sh`
- Ejecutar: `./startup.sh`

- [ ] **Paso 8.1: Comprobación de tipos de TypeScript**
  ```bash
  npm run typecheck
  ```

- [ ] **Paso 8.2: Suite completa de pruebas unitarias e integración**
  ```bash
  npm test
  ```

- [ ] **Paso 8.3: Actualizar `docs/feature-status.md` y auditar**
  - Reflejar la nueva capacidad de acompañantes y espectadores en la tabla de estado de la Agenda.
  - Ejecutar:
    ```bash
    ./scripts/feature-status-audit.sh
    ```

- [ ] **Paso 8.4: Despliegue y reinicio en vivo con `./startup.sh`**
  ```bash
  ./startup.sh
  ```
