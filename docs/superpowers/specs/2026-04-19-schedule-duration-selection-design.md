# Schedule Duration Selection Design

## Goal

Mejorar la seleccion de duracion al crear y editar actividades para que la persona pueda elegir primero como quiere introducirla en lugar de estar limitada a minutos directos.

La UX objetivo es:

- ofrecer un selector inicial de modo de duracion
- permitir que ese selector se use tanto en `Crear actividad` como en `Editar actividad > Durada`
- mantener la persistencia simple usando solo `durationMinutes`

## Scope

La v1 cubre solo:

- el flujo de duracion dentro de `src/telegram/schedule-flow-support.ts`
- el parseo de entrada de duracion en `src/telegram/schedule-parsing.ts`
- los teclados de seleccion de modo en `src/telegram/schedule-keyboards.ts`
- los textos de ayuda y error en `src/telegram/i18n-schedule.ts`
- la presentacion visible de duracion en los mensajes de actividad
- los tests del flujo de actividades en `src/telegram/schedule-flow.test.ts`

La v1 no cubre:

- cambios de esquema, migraciones o nuevos campos persistidos
- distinguir en base de datos entre `sin duracion` y `120 minutos reales`
- cambios en otros modulos ajenos a actividades
- conservar en UI el formato exacto de entrada del usuario

## Current Project Context

Hoy el flujo de actividades trata la duracion como un unico paso que acepta minutos directos o `Ometre`, donde `Ometre` cae en la duracion por defecto ya existente.

El proyecto ya separa bien responsabilidades:

- `schedule-flow-support.ts` orquesta pasos y sesiones
- `schedule-parsing.ts` parsea/coacciona valores
- `schedule-keyboards.ts` construye teclados de ayuda
- `i18n-schedule.ts` centraliza el texto visible

La mejora debe seguir ese patron y mantenerse pequena.

Tambien hay una decision funcional ya cerrada con el usuario:

- si se elige `Sin duracion`, internamente se guardaran `120` minutos
- no se anadira metadata extra para distinguir ese caso de una duracion explicita de `120`
- si mas adelante la UI muestra `2 h`, se acepta porque el objetivo principal es simplificar la eleccion, no introducir un modelo nuevo

## Recommended Architecture

La solucion recomendada introduce un selector de modo de duracion y subpasos pequenos segun el modo elegido.

### 1. Duration Mode Step

Antes del valor de duracion, el flujo debe mostrar un paso `duration-mode` con estas opciones:

- `Sin duracion`
- `Horas`
- `Horas y minutos`
- `Minutos`

En edicion, este paso debe seguir ofreciendo `Mantener valor actual`.

### 2. Mode-Specific Input Steps

Despues de elegir modo, el flujo abre el subpaso correspondiente:

- `Sin duracion`
  - no pide mas datos
  - guarda `durationMinutes = 120`
- `Horas`
  - pide un entero positivo
  - convierte `horas * 60`
- `Horas y minutos`
  - pide formato `HH:mm`
  - convierte a minutos totales
- `Minutos`
  - pide un entero positivo
  - mantiene el comportamiento actual

La implementacion debe usar `stepKey` explicitos por modo en lugar de intentar resolverlo todo en un solo paso ambiguo.

### 3. Simple Persistence Rule

No se anaden campos nuevos ni cambios de modelo.

Regla persistente unica:

- todo acaba convertido en `durationMinutes`

Eso implica que:

- `Sin duracion` se guarda exactamente igual que `120` minutos
- el sistema no sabra despues si ese `120` vino de una eleccion explicita o del atajo `Sin duracion`

Esta perdida de distincion es aceptable en esta fase porque reduce complejidad y evita tocar base de datos.

### 4. Normalized Presentation

Cuando la duracion se muestre en resumenes o detalles de actividad, debe normalizarse como `X h Y min`.

Ejemplos:

- `45` -> `45 min`
- `60` -> `1 h`
- `90` -> `1 h 30 min`
- `120` -> `2 h`

La UI no necesita recordar si la entrada original fue `2`, `02:00`, `120`, o `Sin duracion`.

## Data Flow

### Flow 1: Create with no duration

1. La persona completa fecha y hora.
2. El flujo entra en `duration-mode`.
3. La persona elige `Sin duracion`.
4. El flujo guarda `durationMinutes = 120`.
5. El flujo continua al siguiente paso sin pedir mas entrada de duracion.

### Flow 2: Create with hours

1. La persona entra en `duration-mode`.
2. Elige `Horas`.
3. El flujo pide un entero positivo.
4. La persona escribe `3`.
5. El flujo convierte a `180` minutos y continua.

### Flow 3: Create with hours and minutes

1. La persona entra en `duration-mode`.
2. Elige `Horas y minutos`.
3. El flujo pide formato `HH:mm`.
4. La persona escribe `02:30`.
5. El flujo convierte a `150` minutos y continua.

### Flow 4: Edit with keep current

1. La persona entra en `Editar actividad > Durada`.
2. El flujo muestra `Mantener valor actual` y los modos de seleccion.
3. Si la persona elige `Mantener valor actual`, el flujo vuelve al menu de edicion sin cambiar `durationMinutes`.

## Error Handling

- Si la persona escribe un valor invalido para `Horas`, el flujo debe repetir ese mismo subpaso con un mensaje claro.
- Si la persona escribe un valor invalido para `Horas y minutos`, el flujo debe exigir `HH:mm` y repetir el subpaso.
- Si la persona escribe un valor invalido para `Minutos`, el flujo debe mantener el comportamiento actual de error.
- Si por cualquier motivo falta el modo seleccionado al entrar en un subpaso, el flujo debe volver de forma segura a `duration-mode` en lugar de guardar una duracion corrupta.
- `Mantener valor actual` sigue siendo valido solo en edicion.

## Testing

Los tests deben ampliarse en `src/telegram/schedule-flow.test.ts` para cubrir:

- crear una actividad eligiendo `Sin duracion`
- crear una actividad eligiendo `Horas` y escribiendo un entero
- crear una actividad eligiendo `Horas y minutos` y escribiendo `HH:mm`
- crear una actividad eligiendo `Minutos` y manteniendo el camino actual
- editar una actividad manteniendo el valor actual
- errores de validacion por modo
- render de duraciones visibles normalizadas como `X h Y min`

No hace falta crear archivo de test nuevo.

## Acceptance Criteria

- En creacion y edicion existe un paso inicial para elegir modo de duracion.
- `Sin duracion` guarda `120` minutos sin pedir mas entrada.
- `Horas` acepta enteros positivos y los convierte a minutos.
- `Horas y minutos` acepta `HH:mm` y lo convierte a minutos.
- `Minutos` mantiene el comportamiento actual basado en minutos.
- En edicion, `Mantener valor actual` sigue disponible.
- La UI muestra duraciones como `X h Y min` en lugar de minutos totales.
- No se introducen cambios de base de datos ni metadata adicional.
