# Especificación de Diseño: Gestión de Acompañantes y Espectadores en la Agenda

- **Fecha:** 2026-09-17
- **Estado:** Aprobado para planificación
- **Módulos afectados:** `schedule`, `database`, `telegram`, `http`

---

## 1. Contexto y Objetivos

### 1.1. Problema
En las actividades y partidas del club (como juegos de mesa complejos o partidas de rol), actualmente la inscripción a una actividad de Agenda es unitaria: cada socio que pulsa «Apuntarme» reserva obligatoriamente 1 plaza de juego (`player`).

Sin embargo, en el club es habitual que:
1. Haya socios que deseen asistir exclusivamente a **mirar, aprender las reglas o hacer compañía** como espectadores/oyentes, sin ocupar una silla de jugador en la mesa.
2. Un participante (sea jugador o espectador) desee acudir con **uno o varios acompañantes no registrados** (familiares, amigos o visitas) sin consumir plazas de jugador de la partida.

Hasta ahora, la única alternativa era que el organizador editase manualmente la actividad para reducir las plazas disponibles, lo cual generaba fricción y confusión en el aforo real.

### 1.2. Objetivos
1. Permitir a los socios inscribirse a una actividad con rol de **Jugador** (`player`) o de **Espectador / Acompañante** (`spectator`).
2. Permitir a cualquier participante activo añadir o quitar **acompañantes adicionales** (`guestCount`) de manera ágil desde Telegram.
3. Garantizar que **los acompañantes y espectadores no descuenten plazas de juego** del aforo de la mesa.
4. Mostrar con total claridad en la ficha del evento quién está jugando en mesa y quién asiste como espectador o acompañante.
5. Permitir cambiar de rol de forma dinámica (pasar de espectador a jugador si quedan plazas, o de jugador a espectador liberando su asiento).

---

## 2. Reglas de Negocio y Capacidad

### 2.1. Roles de Participación
- **`player` (Jugador):** Socio activo que ocupa una silla en la partida. Consume 1 plaza del aforo de juego.
- **`spectator` (Espectador / Acompañante):** Socio activo que asiste para mirar o aprender. **No consume plaza de juego**.

### 2.2. Acompañantes Vinculados (`guestCount`)
- Cada participante activo (jugador o espectador) dispone de un contador `guestCount` $\ge 0$.
- Los acompañantes vinculados asisten junto al socio pero **no consumen plazas de juego**.
- Si un socio se desapunta de la actividad, sus acompañantes vinculados causan baja automática con él.

### 2.3. Cálculo de Aforo de Juego (`getScheduleCapacitySnapshot`)
- **Plazas de juego ocupadas:**
  $$\text{occupiedSeats} = \text{initialOccupiedSeats} + \sum (\text{participantes activos con role } = \text{'player'})$$
- **Plazas de juego disponibles:**
  $$\text{availableSeats} = \max(0, \text{capacity} - \text{occupiedSeats})$$
- **Partida completa:**
  $$\text{isFull} = (\text{availableSeats} === 0)$$

### 2.4. Reglas de Inscripción y Cambio de Rol
1. **Inscribirse como Jugador:** Solo permitido en actividades abiertas (`attendanceMode === 'open'`) si $\text{availableSeats} > 0$.
2. **Inscribirse como Espectador:** Permitido en cualquier actividad abierta, incluso si la mesa de jugadores está llena ($\text{availableSeats} === 0$).
3. **Cambiar de Espectador a Jugador:** Permitido únicamente si $\text{availableSeats} > 0$. Ocupa 1 plaza de juego.
4. **Cambiar de Jugador a Espectador:** Siempre permitido en actividades abiertas. Libera de inmediato 1 plaza de juego para otros socios.
5. **Actividades cerradas (`attendanceMode === 'closed'`):** No permiten autoinscripción pública en ningún rol.

---

## 3. Modelo de Datos y Persistencia

### 3.1. Esquema Drizzle (`src/infrastructure/database/schema.ts`)
Modificación de la tabla `schedule_event_participants`:

```typescript
export const scheduleEventParticipants = pgTable(
  'schedule_event_participants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scheduleEventId: bigint('schedule_event_id', { mode: 'number' })
      .notNull()
      .references(() => scheduleEvents.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    participationRole: varchar('participation_role', { length: 16 }).notNull().default('player'),
    guestCount: integer('guest_count').notNull().default(0),
    addedByTelegramUserId: bigint('added_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    removedByTelegramUserId: bigint('removed_by_telegram_user_id', { mode: 'number' }).references(
      () => users.telegramUserId,
    ),
    reminderLeadHours: integer('reminder_lead_hours'),
    reminderPreferenceConfigured: boolean('reminder_preference_configured').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('schedule_event_participants_unique_participant').on(
      table.scheduleEventId,
      table.participantTelegramUserId,
    ),
    check('schedule_event_participants_guest_count_non_negative', sql`${table.guestCount} >= 0`),
  ],
);
```

### 3.2. Repositorio de Dominio (`src/schedule/schedule-catalog.ts` y `schedule-catalog-store.ts`)
- Tipos actualizados:
  - `ScheduleParticipationRole = 'player' | 'spectator'`
  - `ScheduleParticipantRecord`: añade `participationRole: ScheduleParticipationRole` y `guestCount: number`.
- Métodos del repositorio:
  - `upsertParticipant`: ampliado con `participationRole?: ScheduleParticipationRole` y `guestCount?: number`.
  - Métodos de conveniencia de dominio:
    - `joinScheduleEvent({ ..., role?: ScheduleParticipationRole })`
    - `setScheduleEventParticipantRole({ eventId, participantTelegramUserId, role, actorTelegramUserId })`
    - `setScheduleEventParticipantGuests({ eventId, participantTelegramUserId, guestCount, actorTelegramUserId })`

---

## 4. Experiencia de Usuario en Telegram (UI/UX)

### 4.1. Visualización de la Ficha (`formatScheduleEventView`)
El bloque de asistencia diferencia claramente las dos categorías de asistentes:

```html
<b>Plazas de juego ocupadas:</b> 3/4
<b>Plazas libres:</b> 1

<b>Jugadores (3):</b>
- @Ruben (+1 acompañante)
- @Victor
- @Maria
- [Plaza reservada]

<b>Acompañantes / Espectadores (2):</b>
- @Javi
- @Carlos (+1 acompañante)
```
*(Si no hay ningún espectador ni acompañante registrado, el bloque de Espectadores se omite para mantener la vista concisa).*

### 4.2. Botones de Acción en el Detalle del Evento

#### Caso A: El usuario aún no está inscrito
1. **Si quedan plazas de juego (`availableSeats > 0`):**
   - Fila 1: `[ 🎮 Apuntarme a jugar ]`
   - Fila 2: `[ 👀 Apuntarme de espectador ]`
2. **Si la mesa está llena (`availableSeats === 0`):**
   - Fila 1: `[ 👀 Apuntarme de espectador (mesa llena) ]`

#### Caso B: El usuario ya está inscrito
- Fila 1: `[ 👥 Acompañantes (+X) ]` *(donde X es su `guestCount` actual)*
- Fila 2 (Alternar rol):
  - Si es `player`: `[ 👀 Pasar a espectador ]`
  - Si es `spectator`: `[ 🎮 Pasar a jugar ]` *(solo visible si `availableSeats > 0`)*
- Fila 3: `[ 🚪 Desapuntarme ]`

### 4.3. Subflujo Inline de Gestión de Acompañantes (`schedule_act:guests:<id>`)
Al pulsar `[ 👥 Acompañantes (+X) ]`:
1. El bot edita el mensaje o responde inline:
   > *«¿Cuántos acompañantes vendrán contigo a ver la actividad?*
   > *Actualmente tienes: **X** acompañante(s).»*
2. Teclado inline de ajuste rápido:
   - `[ -1 ]`  `[ +1 ]`
   - `[ 0 acompañantes ]`
   - `« Volver a la actividad`
3. Cada botón `+1`, `-1` o `0` actualiza el registro en la base de datos de manera inmediata y refresca el mensaje con el nuevo contador.
4. Al pulsar `« Volver a la actividad`, se muestra nuevamente la ficha completa actualizada.

---

## 5. Integraciones y Sincronizaciones

### 5.1. Google Calendar
- La sincronización bidireccional / publicación de eventos a Google Calendar continúa operando con normalidad.
- En la descripción generada se detalla:
  `Plazas de juego: X/Y (Z libres) · Acompañantes/Espectadores: N`.

### 5.2. Panel Web (`/actividades` y `/admin/activities`)
- En la vista pública y administrativa, el indicador de aforo refleja exclusivamente las plazas de juego de la mesa.
- En el desglose de participantes se muestra el distintivo de espectador y el indicador `(+X)` de acompañantes.

### 5.3. Recordatorios
- Los recordatorios automáticos (1 hora antes, 24 horas antes) se envían a todos los socios activos inscritos en `schedule_event_participants`, independientemente de si su rol es `player` o `spectator`.

---

## 6. Casos Límite y Manejo de Errores

1. **Condición de carrera al ocupar la última plaza de jugador:**
   - Si dos socios intentan inscribirse como `player` simultáneamente cuando queda 1 sola plaza, la transacción valida el snapshot en base de datos.
   - El socio que quede fuera recibe un aviso amigable y se le ofrece un botón para inscribirse como espectador.
2. **Intento de pasar a jugador con mesa completa:**
   - Si un espectador pulsa «Pasar a jugar» pero otro socio se ha adelantado, la acción se rechaza de forma limpia informando que la mesa ya no tiene plazas libres.
3. **Contador de acompañantes no negativo:**
   - Pulsar `[-1]` cuando el contador es `0` mantiene el valor en `0` sin lanzar excepciones ni alterar datos.
4. **Desinscripción:**
   - Al desapuntarse (`leaveScheduleEvent`), el estado pasa a `'removed'` y `guestCount` se reinicia a `0` para no dejar plazas fantasma si el usuario se vuelve a inscribir más tarde.

---

## 7. Plan de Validación y Pruebas

1. **Pruebas de Dominio y Repositorio:**
   - `src/schedule/schedule-catalog.test.ts`:
     - Inscripción como `spectator` no altera `availableSeats`.
     - Inscripción como `player` reduce `availableSeats`.
     - Cambio de rol `player` $\rightarrow$ `spectator` libera plaza.
     - Cambio de rol `spectator` $\rightarrow$ `player` ocupa plaza o falla si está llena.
     - Modificación de `guestCount` no altera la capacidad de juego.
   - `src/schedule/schedule-catalog-store.test.ts`:
     - Persistencia de `participationRole` y `guestCount`.
2. **Pruebas de Flujo Telegram:**
   - `src/telegram/schedule-flow.test.ts`:
     - Teclados inline dinámicos según `availableSeats` y estado de inscripción.
     - Callbacks de inscripción como espectador y cambio de rol.
     - Callbacks de incremento/decremento de acompañantes.
   - `src/telegram/schedule-presentation.test.ts`:
     - Formateo de ficha con bloques de jugadores y espectadores/acompañantes.
3. **Verificación de Integridad:**
   - `npm run typecheck`
   - `npm test`
   - `./startup.sh` para reinicio y prueba en vivo en Telegram.
