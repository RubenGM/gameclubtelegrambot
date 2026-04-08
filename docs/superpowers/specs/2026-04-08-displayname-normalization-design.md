# DisplayName Normalization Design

## Goal

Garantizar que el bot siempre use `displayName` como nombre visible de usuario y que los registros existentes se normalicen para dejar de mostrar IDs de Telegram.

## Scope

La v1 cubre solo:

- normalizacion de usuarios existentes en la tabla `users`
- reparacion automatica de `displayName` al interactuar con un usuario
- uso consistente de `displayName` como fuente principal para nombres visibles
- eliminacion de fallbacks visibles a `Usuari <telegramUserId>` en flujos de Telegram

La v1 no cubre:

- migraciones de esquema para separar nombres historicos
- sincronizacion con fuentes externas de perfil
- edicion manual de nombres desde el bot

## Current Project Context

El proyecto ya guarda usuarios en `users` con `username` y `displayName`.

El runtime de Telegram ya recibe `from.first_name` y `from.last_name` en el contexto entrante, pero el `TelegramActor` actual no transporta `displayName`.

Ahora mismo hay flujos que resuelven el nombre con esta logica:

- si existe `displayName`, usarlo
- si no, usar `username`
- si no, caer a `Usuari <telegramUserId>`

Eso permite que aparezcan IDs en mensajes de actividad o notificaciones cuando el usuario no esta bien normalizado.

## Recommended Architecture

### 1. Source of Truth for Visible Names

`displayName` pasa a ser la unica etiqueta humana visible en todos los flujos que muestran personas.

Regla:

- `displayName` se construye desde el perfil Telegram cuando es posible
- si falta o esta vacio, se repara antes de mostrar cualquier texto
- `username` queda como metadato auxiliar, no como nombre principal

### 2. Interaction-Time Normalization

En la capa de entrada de Telegram se calcula el nombre visible del remitente y se asegura su persistencia en `users` antes de continuar con el resto del flujo.

Esto evita que un usuario nuevo o existente siga produciendo mensajes con IDs si entra por cualquier comando, callback o texto relevante.

La normalizacion debe ser barata:

- una lectura del usuario actual
- una escritura solo si falta `displayName` o cambia el valor normalizado

### 3. Backfill for Existing Rows

Los usuarios ya existentes se corrigen con una operacion de mantenimiento sobre `users`.

Objetivo del backfill:

- rellenar `displayName` cuando este vacio o contenga solo espacios
- conservar `username` si existe
- no tocar usuarios ya correctos

Si la base no tiene suficiente informacion para reconstruir un nombre humano, el registro debe quedar marcado para revision operativa en vez de seguir mostrando el ID en mensajes nuevos.

### 4. Name Resolution

Los flujos que formatean mensajes de actividad, auditoria o notificaciones deben leer el nombre desde una funcion unica de resolucion.

Esa funcion debe:

- devolver `displayName` limpio cuando exista
- caer a un valor normalizado solo si el registro aun no esta reparado
- no mezclar varias reglas distintas segun el flujo

## Data Flow

1. Llega una interaccion de Telegram con `from`.
2. Se obtiene el usuario persistido.
3. Si `displayName` falta o es invalido, se calcula un nombre visible y se guarda.
4. El flujo continua.
5. Los mensajes de actividad y notificaciones usan el `displayName` ya normalizado.

## Error Handling

- Si Telegram no aporta suficiente nombre, se mantiene el mejor valor disponible en la base, pero no se fabrica un ID como nombre visible salvo como ultima defensa tecnica.
- Si la normalizacion falla en escritura, el flujo principal no debe romperse; el mensaje puede continuar con el nombre ya disponible y registrar el fallo.
- El backfill debe ser idempotente.

## Testing

Se cubriran estos casos:

- usuario nuevo con `first_name` visible se guarda con `displayName`
- usuario existente sin `displayName` se repara al interactuar
- mensajes de actividad usan `displayName` y no `telegramUserId`
- backfill no modifica usuarios ya correctos
- usuarios sin nombre util no vuelven a mostrar el ID en flujos normales una vez reparados

## Acceptance Criteria

- Ningun mensaje visible de actividad muestra `Usuari <id>` si el usuario esta normalizado.
- Los usuarios existentes quedan corregidos sin intervencion manual.
- La logica de nombres queda centralizada y no duplicada por flujo.
