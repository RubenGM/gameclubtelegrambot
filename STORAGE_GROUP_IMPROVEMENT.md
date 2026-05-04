# Storage Group Improvement

## Objetivo

Mejorar la creacion de categorias de `storage` para que el bot lleve mucho mas de la mano al admin y no le obligue a introducir manualmente:

- el `chat id` del supergrupo de storage
- el `thread id` del topic de la categoria

La experiencia deseada es que el bot ayude a:

1. seleccionar el supergrupo correcto desde Telegram
2. verificar que el chat es valido para storage
3. crear o seleccionar el topic de la categoria
4. guardar automaticamente `storageChatId` y `storageThreadId`

## Lo pedido

Durante la creacion de una categoria de almacenamiento, en vez de pedir:

- `Escribe el chat id del supergrupo de storage.`

el bot deberia ofrecer un flujo mucho mas guiado y, cuando sea posible, resolver esos datos directamente.

## Situacion actual

Hoy el flujo de alta de categoria hace esto:

1. pide `slug`
2. pide nombre visible
3. pide descripcion opcional
4. pide `storageChatId`
5. pide `storageThreadId`

Problemas:

- obliga al admin a conocer ids internos de Telegram
- es facil equivocarse de chat o topic
- no valida bien si el chat es realmente un supergrupo con topics
- no ayuda a crear el topic si aun no existe
- hace la feature mucho menos usable para admins no tecnicos

## Mejora propuesta

### Recomendacion principal

Implementar un flujo guiado en dos pasos:

1. seleccionar o compartir el supergrupo de storage desde Telegram
2. crear automaticamente el topic de la categoria usando `createForumTopic`

Con esto, el admin solo tendria que decidir:

- nombre/slug/descripcion de la categoria
- en que supergrupo quiere alojarla

El bot resolveria el resto.

## UX deseada

### Flujo ideal

1. Admin abre `Almacenamiento`
2. Pulsa `Crear categoria`
3. Bot pide:
   - slug
   - nombre visible
   - descripcion opcional
4. Bot muestra una accion guiada para seleccionar el supergrupo de storage
5. Admin comparte el chat usando un boton de Telegram
6. Bot valida que:
   - es un supergrupo
   - el bot pertenece al chat
   - el chat tiene topics activados o es apto para `createForumTopic`
   - el bot tiene permisos suficientes
7. Bot pregunta:
   - `Crear topic automaticamente`
   - o `Usar un topic existente` si en una iteracion posterior soportamos seleccion manual
8. Bot llama a `createForumTopic`
9. Bot guarda la categoria con:
   - `storageChatId`
   - `storageThreadId`
10. Bot confirma la categoria creada y el topic asociado

### Fallback razonable

Si Telegram o el SDK no permiten completar el flujo guiado en una situacion concreta:

- el bot debe caer a un modo asistido
- nunca volver directamente a un prompt crudo de ids sin explicacion

Modo asistido minimo:

- explicar como obtener el chat
- explicar por que hace falta el topic
- ofrecer reintento guiado o entrada manual como ultimo recurso

## Cambios funcionales necesarios

### 1. Seleccion del chat desde Telegram

Hay que soportar un boton de teclado con `request_chat`.

Objetivo:

- que el admin comparta el supergrupo de storage con el bot

Esto implica:

- extender el modelo de `replyKeyboard` para representar botones con `request_chat`
- adaptar `toRawReplyKeyboardButton` para emitir ese payload raw del Bot API
- soportar en el runtime el update de respuesta correspondiente al chat compartido

Notas:

- el repo ya usa `replyKeyboard` raw con estilos
- el skill de Telegram recomienda usar payload raw si el wrapper va por detras del Bot API
- este caso encaja justo en esa recomendacion

### 2. Soporte de `chat_shared` o equivalente en el runtime

Cuando el usuario pulse el boton de compartir chat, Telegram enviara una respuesta especial.

Hace falta:

- detectar ese update en `runtime-boundary-support`
- exponerlo al flujo como parte del `TelegramCommandHandlerContext`
- permitir que `storage-flow.ts` lo consuma durante la sesion de creacion de categoria

Necesitaremos probablemente nuevos campos en contexto, por ejemplo:

- `sharedChatId`
- `sharedChatTitle` si existe
- `sharedChatRequestId`

### 3. Validacion del chat seleccionado

Una vez compartido el chat, el bot debe validar:

- que el chat es un supergrupo, no un grupo normal ni un canal
- que el bot es miembro del chat
- que el bot puede operar alli
- que el chat soporta topics o foro

Bot API / llamadas esperables:

- `getChat`
- opcionalmente `getChatMember` para validar permisos del bot

Comprobaciones deseables:

- `type == supergroup`
- `is_forum == true` o equivalente disponible
- permisos admin suficientes para crear topic y moderar si hace falta

Si falla algo, el mensaje al admin debe ser explicito:

- `Ese chat no es un supergrupo con topics`
- `El bot no es administrador en ese chat`
- `El bot no puede crear topics en ese chat`

### 4. Creacion automatica del topic

Una vez validado el chat, el bot debe poder crear el topic de la categoria.

Llamada esperada:

- `createForumTopic`

Nombre recomendado del topic:

- por defecto, el `displayName` de la categoria

Opciones futuras:

- color/icono del topic
- politica de nombres

Resultado a persistir:

- `storageChatId = chat_id`
- `storageThreadId = message_thread_id` devuelto por Telegram

### 5. Posible soporte para topic existente

Esto no es imprescindible para la primera mejora, pero conviene dejarlo previsto.

Casos donde interesa:

- ya existe el topic y no se quiere duplicar
- el admin quiere reutilizar una estructura previa

Problema:

- Telegram no da una API sencilla y universal para listar topics como menu simple del bot

Por eso, recomendacion de alcance:

- v1 de mejora: solo `crear topic automaticamente`
- v2: permitir enlazar un topic existente

## Cambios tecnicos concretos

### `src/telegram/runtime-boundary-registration.ts`

Habra que permitir que el flujo de storage reciba updates de chat compartido o similares durante sesiones privadas.

### `src/telegram/runtime-boundary-support.ts`

Habra que extender:

- parsing de updates especiales relacionados con `request_chat`
- serializacion de botones `request_chat`
- posiblemente soporte para `callApi` raw si el wrapper no expone todo

### `src/telegram/command-registry.ts`

Probablemente necesite nuevos campos opcionales en `TelegramCommandHandlerContext` para transportar:

- informacion de chat compartido
- request id asociado

### `src/telegram/storage-flow.ts`

El flujo de `Crear categoria` deberia cambiar de:

- pedir `storageChatId`
- pedir `storageThreadId`

a algo parecido a:

- `create-category-chat-select`
- `create-category-chat-validate`
- `create-category-topic-mode`
- `create-category-topic-create`

### `src/telegram/i18n-storage.ts`

Hay que anadir textos para:

- compartir supergrupo
- chat invalido
- bot sin permisos
- chat sin topics
- creando topic
- topic creado
- reintentar
- usar entrada manual como fallback

### `src/telegram/runtime-boundary.test.ts`

Habra que cubrir:

- serializacion de `request_chat`
- captura del update compartido

### `src/telegram/storage-flow.test.ts`

Habra que anadir tests de:

- seleccion guiada del supergrupo
- rechazo si no es supergrupo valido
- rechazo si el bot no tiene permisos
- creacion automatica del topic
- persistencia correcta de `storageChatId` y `storageThreadId`
- fallback manual cuando no se pueda completar automaticamente

## Permisos y precondiciones

Para que esto funcione bien, el bot deberia:

- estar dentro del supergrupo de storage
- idealmente ser admin en ese supergrupo
- tener permisos para crear topics y gestionar mensajes si queremos limpieza/soporte futuro

Si no se cumplen estas condiciones, el flujo debe detectarlo pronto y explicarlo.

## Casos limite a contemplar

### 1. El admin comparte un chat incorrecto

Ejemplos:

- canal
- grupo normal
- chat privado

Respuesta esperada:

- mensaje claro
- opcion de reintentar

### 2. El bot no esta en el chat

Respuesta esperada:

- `Anade primero el bot al supergrupo y vuelve a intentarlo`

### 3. El bot esta en el chat pero no es admin

Respuesta esperada:

- `Haz administrador al bot para poder crear topics automaticamente`

### 4. El supergrupo no tiene topics activados

Respuesta esperada:

- indicarlo claramente
- si Telegram lo permite, ofrecer ayuda para activarlos
- si no, pedir usar un supergrupo correcto

### 5. Falla `createForumTopic`

Respuesta esperada:

- no crear la categoria en BD
- informar al admin
- permitir reintentar

### 6. El topic se crea pero la persistencia falla

Respuesta esperada:

- informar de estado parcial
- recomendar al admin revisar si quiere reutilizar ese topic al reintentar

Este es un punto importante: la operacion no es totalmente atomica entre Telegram y BD.

## Recomendaciones de producto

### Recomendacion principal

Implementar ya:

- seleccion guiada de supergrupo con `request_chat`
- validacion fuerte del chat
- creacion automatica del topic con `createForumTopic`

### Recomendacion secundaria

Mantener entrada manual solo como fallback escondido, no como flujo principal.

### Recomendacion UX

Usar botones con color siempre que tenga sentido:

- `Compartir supergrupo` como `primary` o `success`
- `Crear topic automaticamente` como `success`
- `Reintentar` como `secondary`
- `Cancelar` como `danger`

## Alcance sugerido

### Fase 1

- `request_chat`
- validacion del supergrupo
- `createForumTopic`
- persistencia automatica de ids
- fallback manual

### Fase 2

- enlazar topic existente
- mejor diagnostico de permisos
- posible comprobacion/repair de topics huérfanos

## Criterio de exito

La mejora estara bien implementada si un admin no tecnico puede:

1. crear una categoria desde Telegram
2. elegir el supergrupo correcto sin saber su `chat_id`
3. dejar que el bot cree el topic
4. terminar el flujo sin introducir ids manuales

Y si ademas, cuando algo falla, el bot responde con instrucciones claras y accionables.
