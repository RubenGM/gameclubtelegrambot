# Schedule Time Selection Design

## Goal

Mejorar la seleccion de hora al crear y editar actividades para que el flujo sea mas rapido en los casos habituales sin perder flexibilidad.

La UX objetivo es:

- si la persona escribe una hora completa `HH:MM`, el bot la acepta directamente
- si la persona escribe solo la hora `HH`, el bot ofrece un segundo paso con botones `:00`, `:15`, `:30` y `:45`
- este comportamiento debe existir tanto en `Crear actividad` como en `Editar actividad > Hora inicio`

## Scope

La v1 cubre solo:

- el flujo de hora dentro de `src/telegram/schedule-flow-support.ts`
- el parseo de hora en `src/telegram/schedule-parsing.ts`
- los teclados de ayuda para seleccionar minutos en `src/telegram/schedule-keyboards.ts`
- los textos de ayuda y error en `src/telegram/i18n-schedule.ts`
- los tests del flujo de calendario en `src/telegram/schedule-flow.test.ts`

La v1 no cubre:

- cambios en otros flujos de fecha u hora fuera de actividades
- limitar manualmente las horas a cuartos de hora
- autocompletado visual de horas por rango como `17:00`, `17:15`, `17:30`, `17:45`
- cambios en venue events u otros modulos que tambien usan `HH:MM`

## Current Project Context

El flujo actual de actividades ya separa responsabilidades de forma razonable:

- `schedule-flow-support.ts` orquesta sesiones, transiciones y replies
- `schedule-parsing.ts` concentra parseo y coercion de valores
- `schedule-keyboards.ts` construye teclados de ayuda
- `i18n-schedule.ts` centraliza los textos visibles

Hoy, tras seleccionar la fecha, tanto crear como editar pasan a un unico paso `time` que solo acepta `HH:MM`.

Esto hace que el caso frecuente de escribir solo `17` obligue a corregir manualmente la entrada aunque el minuto habitual sea uno de cuatro valores muy previsibles.

La solucion debe respetar dos decisiones ya validadas con el usuario:

- seguir aceptando horas libres como `17:20`
- aplicar el mismo comportamiento en crear y editar para que la experiencia sea consistente

## Recommended Architecture

La solucion recomendada mantiene el flujo actual y solo introduce un subpaso pequeno para minutos.

### 1. Time Parsing Split

`schedule-parsing.ts` debe distinguir tres casos:

- hora completa valida `HH:MM`
- hora base valida `HH`
- valor invalido

La validacion de `HH:MM` no cambia como contrato principal de persistencia.

Se anade un parseo complementario para `HH` que solo sirve para entrar en el subflujo de minutos. Ese valor no se persiste como hora final; se guarda temporalmente en la sesion hasta que se elija el sufijo de minutos.

### 2. Minute Selection Substep

`schedule-flow-support.ts` debe soportar un subpaso adicional para hora:

- en crear: si la entrada es `HH`, avanzar a un paso de minutos y guardar la hora base
- en editar: si la entrada es `HH`, hacer lo mismo pero manteniendo tambien la opcion de conservar el valor actual

Comportamiento esperado:

- `17:20` sigue llevando directamente al siguiente paso del flujo
- `17` lleva a un reply con botones `:00`, `:15`, `:30`, `:45`
- al pulsar `:15`, el flujo compone `17:15` y continua exactamente igual que hoy

La implementacion debe usar un `stepKey` explicito para minutos en lugar de reciclar el mismo `time`, porque eso mantiene la maquina de estados mas clara y reduce ambiguedad en mensajes y tests.

### 3. Dedicated Keyboards

`schedule-keyboards.ts` debe anadir teclados especificos para este subpaso:

- crear: una fila o varias filas con `:00`, `:15`, `:30`, `:45`, mas `/cancel`
- editar: lo mismo, pero con `Mantener valor actual` disponible cuando corresponda

No hace falta generar botones por hora completa. La hora base ya la aporta el usuario y el teclado solo completa el sufijo de minutos.

### 4. Explicit Messaging

`i18n-schedule.ts` debe dejar claro el nuevo contrato del paso:

- se puede escribir `HH:MM`
- se puede escribir solo `HH`
- si se escribe solo `HH`, el bot mostrara botones rapidos para minutos

Los mensajes de error tambien deben cubrir ambos formatos para evitar que el usuario interprete que `17` sigue siendo invalido.

## Data Flow

### Flow 1: Create with full time

1. La persona llega al paso de hora tras escoger fecha.
2. Escribe `17:20`.
3. El parseo reconoce `HH:MM` completo.
4. El flujo guarda `17:20` y pasa al paso de duracion.

### Flow 2: Create with hour plus quick minutes

1. La persona llega al paso de hora tras escoger fecha.
2. Escribe `17`.
3. El parseo reconoce una hora base valida.
4. La sesion guarda temporalmente `17` y avanza al subpaso de minutos.
5. El bot responde con botones `:00`, `:15`, `:30`, `:45`.
6. La persona pulsa `:15`.
7. El flujo compone `17:15`, lo guarda como hora final y pasa al paso de duracion.

### Flow 3: Edit with quick minutes

1. La persona entra en `Editar actividad > Hora inicio`.
2. Escribe `19`.
3. La sesion entra en el subpaso de minutos y guarda `19` como base temporal.
4. El bot muestra `Mantener valor actual`, `:00`, `:15`, `:30`, `:45` y `/cancel`.
5. Si la persona elige `:45`, el flujo vuelve al menu de edicion con `19:45` como nuevo valor preparado.
6. Si elige `Mantener valor actual`, el flujo vuelve al menu de edicion sin cambiar la hora del evento.

## Error Handling

- Si la persona escribe un valor que no es `HH` ni `HH:MM`, el bot responde con el mensaje de hora invalida y vuelve a mostrar el teclado adecuado.
- Si la persona llega al subpaso de minutos y escribe o pulsa un valor fuera de `:00`, `:15`, `:30`, `:45`, el bot debe rechazarlo y volver a mostrar esas opciones.
- Si falta la hora base temporal al entrar en el subpaso de minutos, el flujo debe fallar de forma segura volviendo al paso principal de hora en lugar de construir una hora corrupta.
- `Mantener valor actual` sigue siendo valido solo en los pasos de edicion, nunca en el flujo de creacion.

## Testing

Los tests deben ampliarse en `src/telegram/schedule-flow.test.ts` para cubrir:

- crear una actividad escribiendo `17` y completando con `:15`
- crear una actividad escribiendo directamente `17:20`
- editar una actividad escribiendo `19` y completando con `:45`
- editar una actividad manteniendo el valor actual desde el flujo de hora
- rechazo de entradas invalidas tanto en el paso principal de hora como en el subpaso de minutos

No hace falta introducir un archivo de test nuevo. El comportamiento cabe dentro de la suite existente del flujo de actividades.

## Acceptance Criteria

- En creacion, `HH:MM` sigue funcionando como entrada directa.
- En creacion, `HH` abre un subpaso con botones `:00`, `:15`, `:30`, `:45`.
- En edicion, `HH:MM` sigue funcionando como entrada directa.
- En edicion, `HH` abre el mismo subpaso rapido de minutos y mantiene la opcion `Mantener valor actual`.
- El flujo nunca persiste una hora parcial como `17`.
- Los mensajes de ayuda y error reflejan que ahora se aceptan `HH` y `HH:MM`.
- La suite de tests del flujo de actividades cubre ambos caminos y los errores principales.
