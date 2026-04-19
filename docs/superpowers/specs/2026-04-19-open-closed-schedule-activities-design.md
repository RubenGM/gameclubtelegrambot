# Open And Closed Schedule Activities Design

## Goal

Ampliar las actividades para soportar dos modos de asistencia:

- `open` para mesas abiertas con plazas totales y una ocupacion inicial bloqueada
- `closed` para grupos cerrados con un total fijo de personas y sin apuntarse desde el bot

La UX objetivo es:

- permitir elegir `Abierta` o `Cerrada` durante la creacion de la actividad
- en abiertas, recoger plazas totales y plazas ya ocupadas
- impedir que los apuntados desde Telegram superen las plazas libres reales
- mostrar lista y detalle distintos para abiertas y cerradas
- dejar fijo el tipo de actividad tras la creacion
- dejar de autoapuntar al organizador al crear una actividad

## Scope

La v1 cubre solo:

- el modelo de actividades en `src/schedule/schedule-catalog.ts`
- la persistencia y el esquema de `schedule_events`
- el flujo de creacion y edicion en `src/telegram/schedule-flow-support.ts`
- el parseo y teclados de los nuevos pasos de actividad
- los resumenes, la lista y el detalle visibles de actividades
- los tests de dominio, store y flujo ya existentes para actividades

La v1 no cubre:

- cambiar una actividad de `Abierta` a `Cerrada` o viceversa despues de crearla
- representar plazas iniciales ocupadas como personas nominales
- precargar asistentes reales en una actividad cerrada
- nuevas funciones de reserva avanzada, lista de espera o sobreaforo manual
- cambios en broadcasts de actividad fuera del formato normal de lista/detalle ya existente

## Current Project Context

Hoy el sistema modela las actividades con un solo `capacity` y deriva la ocupacion contando participantes activos en `schedule_event_participants`.

Tambien existe una regla actual que autoanade al organizador como participante al crear una actividad. Esa regla deja de ser valida porque una persona responsable puede crear actividades en nombre de otras personas y no debe consumir plazas automaticamente.

La arquitectura actual ya esta bastante separada:

- `src/schedule/schedule-catalog.ts` concentra reglas de dominio, aforo y joins
- `src/schedule/schedule-catalog-store.ts` persiste el modelo sin demasiada logica
- `src/telegram/schedule-flow-support.ts` orquesta sesiones de crear, editar y cancelar
- `src/telegram/schedule-parsing.ts` concentra parseo y coercion de inputs
- `src/telegram/schedule-keyboards.ts` construye teclados de apoyo
- `src/telegram/schedule-presentation.ts` renderiza lista, detalle y acciones visibles
- `src/telegram/schedule-draft-summary.ts` renderiza el borrador previo a guardar

La mejora debe seguir ese patron y mantener cada cambio en su capa natural.

## Recommended Architecture

La solucion recomendada introduce campos explicitos para modo de asistencia y ocupacion inicial, y adapta el flujo y la presentacion sin reutilizar participantes ficticios.

### 1. Persisted Event Model

`schedule_events` debe ampliarse con dos campos nuevos:

- `attendanceMode`: `open` o `closed`
- `initialOccupiedSeats`: entero mayor o igual que cero

`capacity` se mantiene y representa siempre el total visible:

- en abiertas: total de plazas de la mesa abierta
- en cerradas: total fijo de personas del grupo

Reglas de persistencia:

- abiertas: `0 <= initialOccupiedSeats <= capacity`
- cerradas: `initialOccupiedSeats = 0`

No se anade ningun campo adicional para guardar asistentes iniciales individualizados.

### 2. Domain Capacity Rules

El dominio debe distinguir entre plazas bloqueadas y participantes reales del bot.

Para actividades abiertas:

- `occupiedSeats = initialOccupiedSeats + activeTelegramParticipants`
- `availableSeats = capacity - occupiedSeats`
- `join` solo se permite si `availableSeats > 0`

Para actividades cerradas:

- no se permite `join`
- no se permite `leave` como flujo operativo normal
- el detalle no muestra asistentes del bot

La regla de autoapuntar al organizador al crear una actividad debe eliminarse por completo.

### 3. Create Flow Changes

Tras la duracion, el flujo de creacion debe insertar dos pasos nuevos antes de la mesa:

1. `attendance-mode`
2. `capacity`
3. `initial-occupied-seats` solo si el modo es `open`

Orden completo de la v1:

1. titulo
2. descripcion
3. fecha
4. hora
5. duracion
6. modo de asistencia
7. plazas o total de personas
8. plazas ya ocupadas solo para abiertas
9. mesa
10. confirmacion

Comportamiento:

- `Abierta`: preguntar total y luego ocupacion inicial
- `Cerrada`: preguntar solo total y saltar directamente a mesa
- la ocupacion inicial debe ofrecer una opcion rapida `0` ademas de aceptar input manual

### 4. Edit Flow Changes

El tipo `open` o `closed` queda fijo tras crear la actividad.

El menu de edicion debe adaptarse segun el tipo:

- abierta:
  - permitir editar `capacity`
  - permitir editar `initialOccupiedSeats`
- cerrada:
  - permitir editar `capacity`
  - no mostrar el campo de ocupacion inicial

No debe existir opcion de editar `attendanceMode` en esta fase.

### 5. Presentation Rules

La lista y el detalle deben ramificarse por `attendanceMode`.

Lista abierta:

- formato objetivo: `14h-15h Testing (https://t.me/... ) · Mesa abierta · 4p (2 libres) · Mesa TV`

Lista cerrada:

- formato objetivo: `14h-15h Testing (https://t.me/... ) · 4p · Mesa TV`

Detalle abierto:

- mostrar modo de actividad
- mostrar plazas totales
- mostrar plazas ocupadas iniciales
- mostrar asistentes reales del bot
- mostrar plazas libres
- mostrar botones `Apuntar-me` o `Sortir` segun corresponda

Detalle cerrado:

- mostrar solo el total fijo de personas como dato de aforo
- no mostrar plazas libres
- no mostrar ocupacion inicial
- no mostrar asistentes del bot
- no mostrar botones de `join` ni `leave`

## Data Flow

### Flow 1: Create Open Activity

1. La persona completa titulo, descripcion, fecha, hora y duracion.
2. El flujo entra en `attendance-mode`.
3. La persona elige `Abierta`.
4. El flujo pide plazas totales.
5. La persona escribe `5`.
6. El flujo pide plazas ya ocupadas.
7. La persona escribe `3` o pulsa `0`.
8. El flujo continua a mesa y confirmacion.
9. La actividad se guarda con `attendanceMode = open`, `capacity = 5`, `initialOccupiedSeats = 3`.

### Flow 2: Join Open Activity

1. La actividad abierta tiene `capacity = 5` e `initialOccupiedSeats = 3`.
2. Hay `0` participantes activos del bot.
3. El primer usuario se apunta y quedan `1` libre.
4. El segundo usuario se apunta y quedan `0` libres.
5. Un tercer usuario intenta apuntarse.
6. El dominio rechaza el join porque ya no quedan plazas reales.

### Flow 3: Create Closed Activity

1. La persona completa titulo, descripcion, fecha, hora y duracion.
2. Elige `Cerrada`.
3. El flujo pide total fijo de personas.
4. La persona escribe `4`.
5. El flujo salta directamente a mesa y confirmacion.
6. La actividad se guarda con `attendanceMode = closed`, `capacity = 4`, `initialOccupiedSeats = 0`.

### Flow 4: Edit Open Activity Capacity Safely

1. La actividad abierta tiene `capacity = 5`, `initialOccupiedSeats = 2` y `2` participantes activos.
2. El total ocupado real es `4`.
3. La persona entra en `Editar > Places` y escribe `3`.
4. El flujo rechaza el cambio porque dejaria la actividad con menos plazas que ocupacion real.
5. La persona debe introducir `4` o mas.

## Error Handling

- Si `capacity` no es un entero positivo, el flujo repite el paso con mensaje claro.
- Si `initialOccupiedSeats` no es un entero valido, el flujo repite el paso con mensaje claro.
- Si `initialOccupiedSeats > capacity`, el flujo debe rechazarlo explicitamente.
- Si se reduce `capacity` por debajo de `initialOccupiedSeats + activeTelegramParticipants`, la edicion debe rechazarse.
- Si se intenta subir `initialOccupiedSeats` por encima de `capacity - activeTelegramParticipants`, la edicion debe rechazarse.
- Si un callback antiguo intenta `join` una actividad cerrada, el servidor debe rechazarlo aunque no haya boton visible.
- Si un callback antiguo intenta `leave` una actividad cerrada, el servidor debe responder de forma segura sin exponer un estado incoherente.
- Si faltan en sesion `attendanceMode` o datos dependientes al avanzar entre pasos, el flujo debe volver al paso anterior seguro en lugar de persistir datos corruptos.

## Implementation Notes

### Schema And Store

- ampliar `src/infrastructure/database/schema.ts` con los nuevos campos de `schedule_events`
- anadir la migracion correspondiente del esquema
- actualizar `src/schedule/schedule-catalog-store.ts` para leer y escribir ambos campos

### Domain

- ampliar `ScheduleEventRecord` y los contratos de `createEvent` y `updateEvent`
- introducir calculo de aforo sobre `initialOccupiedSeats + active participants`
- eliminar de `createScheduleEvent` el `upsertParticipant` automatico del organizador
- endurecer `joinScheduleEvent` y `leaveScheduleEvent` para el nuevo `attendanceMode`

### Telegram Flow

- anadir `attendance-mode` e `initial-occupied-seats` como `stepKey` explicitos
- reutilizar el patron actual de subpasos pequenos y mensajes de error localizados
- en edicion, generar el menu de campos segun `attendanceMode`

### Presentation

- extraer una funcion pequena de resumen visible por actividad para la lista
- ampliar `formatScheduleEventDetails` o introducir una variante por modo sin mezclar ramas grandes en la misma plantilla
- actualizar `buildScheduleDetailActionOptions` para ocultar `join` y `leave` en cerradas
- actualizar `formatScheduleDraftSummary` para mostrar modo y ocupacion inicial cuando aplique

## Testing

Se deben ampliar tests existentes, sin crear una suite paralela nueva.

### Domain Tests

En `src/schedule/schedule-catalog.test.ts` cubrir:

- crear una actividad abierta persistiendo `attendanceMode` e `initialOccupiedSeats`
- crear una actividad cerrada con `initialOccupiedSeats = 0`
- confirmar que el organizador no queda autoapuntado
- impedir joins cuando una abierta ya ha agotado plazas por ocupacion inicial mas participantes
- impedir joins en cerradas
- impedir ediciones de aforo que dejen el evento por debajo de la ocupacion real

### Flow Tests

En `src/telegram/schedule-flow.test.ts` cubrir:

- crear una abierta indicando plazas totales y ocupadas iniciales
- crear una cerrada con total fijo
- lista visible en formato abierta
- lista visible en formato cerrada
- detalle abierto con libres y acciones
- detalle cerrado sin acciones de apuntarse
- edicion abierta de `capacity`
- edicion abierta de `initialOccupiedSeats`
- ausencia del campo `initialOccupiedSeats` en cerradas
- rechazo cuando el aforo o la ocupacion inicial dejan el estado incoherente

### Store Tests

En `src/schedule/schedule-catalog-store.test.ts` cubrir:

- roundtrip de `attendanceMode` e `initialOccupiedSeats`
- compatibilidad de lectura y escritura del nuevo esquema en repositorio

## Acceptance Criteria

- La creacion de actividades permite elegir `Abierta` o `Cerrada`.
- Las abiertas guardan `capacity` total e `initialOccupiedSeats` independiente de participantes del bot.
- Las cerradas guardan total fijo y no permiten apuntarse desde el bot.
- El organizador deja de autoapuntarse al crear actividades.
- El calculo de plazas libres en abiertas descuenta ocupacion inicial y participantes activos.
- La lista muestra el formato especifico de abiertas y cerradas.
- El detalle de abiertas muestra libres y acciones; el de cerradas no.
- El tipo de actividad no se puede editar despues de crearla.
- En edicion solo se permiten cambios coherentes con la ocupacion real existente.
- La suite de tests existente cubre dominio, store y flujo con el nuevo comportamiento.
