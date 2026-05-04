# Storage

Ultima revision: 2026-05-04.

Este documento es la referencia funcional y tecnica de `Storage`: que esta hecho, que falta y como completarlo cuando retomemos la feature.

## Estado ejecutivo

Estado actual: `parcial`.

La base funcional esta implementada: categorias, permisos, indice en PostgreSQL, subida por DM, subida directa en topics, busqueda, apertura de entradas y borrado logico. La parte incompleta no es el almacenamiento en si, sino la experiencia de configuracion: crear una categoria aun obliga al admin a escribir manualmente `storageChatId` y `storageThreadId`.

La siguiente iteracion debe centrarse en alta guiada de categorias:

- seleccionar el supergrupo con un boton `request_chat`
- capturar `chat_shared` en el runtime
- validar que el chat sirve para storage
- crear el topic con `createForumTopic`
- guardar automaticamente `storageChatId` y `storageThreadId`
- mantener entrada manual solo como fallback asistido

## Objetivo de la feature

`Storage` permite guardar archivos del club usando Telegram como almacenamiento canonico de binarios y PostgreSQL como indice operativo.

Regla central:

- los binarios viven en Telegram
- PostgreSQL solo guarda categorias, entradas, mensajes canonicos, permisos y auditoria
- una entrada siempre apunta a mensajes reales dentro del topic canonico de su categoria
- las subidas por DM se copian primero al topic canonico y solo despues se indexan

## Arquitectura actual

### Telegram como storage canonico

Cada categoria apunta a:

- `storageChatId`: id del supergrupo privado de storage
- `storageThreadId`: id del topic dentro del supergrupo

Ese topic es la ubicacion canonica de todos los adjuntos de la categoria.

### PostgreSQL como indice

PostgreSQL guarda:

- categorias de storage
- entradas logicas
- mensajes/adjuntos que forman cada entrada
- permisos por categoria mediante `user_permission_assignments`
- auditoria de cambios administrativos

### Modulos principales

| Capa | Ficheros |
| --- | --- |
| Dominio | `src/storage/storage-catalog.ts` |
| Persistencia | `src/storage/storage-catalog-store.ts` |
| Permisos por categoria | `src/storage/storage-category-access-store.ts` |
| Flujo Telegram | `src/telegram/storage-flow.ts` |
| Textos | `src/telegram/i18n-storage.ts` |
| Runtime Telegram | `src/telegram/runtime-boundary-support.ts`, `src/telegram/runtime-boundary-registration.ts` |
| Tipos runtime | `src/telegram/runtime-boundary.ts`, `src/telegram/command-registry.ts` |
| Schema | `src/infrastructure/database/schema.ts` |

## Modelo de datos

### `storage_categories`

Representa una categoria de archivos.

Campos principales:

- `id`
- `slug`
- `display_name`
- `description`
- `storage_chat_id`
- `storage_thread_id`
- `lifecycle_status`
- `created_at`
- `updated_at`
- `archived_at`

Restricciones relevantes:

- `slug` unico
- `storage_chat_id + storage_thread_id` unico
- `lifecycle_status` permite separar categorias activas y archivadas

### `storage_entries`

Representa una subida logica. Una entrada puede contener uno o varios mensajes.

Campos principales:

- `id`
- `category_id`
- `created_by_telegram_user_id`
- `source_kind`
- `description`
- `tags`
- `lifecycle_status`
- `created_at`
- `updated_at`
- `deleted_at`
- `deleted_by_telegram_user_id`

Valores usados de `source_kind`:

- `dm_copy`: subida privada copiada al topic canonico
- `topic_direct`: subida publicada directamente en el topic canonico

Estados previstos de entrada:

- `active`: visible y abrible
- `deleted`: borrado logico
- `hidden`: previsto por modelo, no hay flujo dedicado actual
- `missing_source`: previsto por modelo, no hay flujo automatico actual

### `storage_entry_messages`

Representa cada mensaje canonico de Telegram que pertenece a una entrada.

Campos principales:

- `id`
- `entry_id`
- `storage_chat_id`
- `storage_message_id`
- `storage_thread_id`
- `telegram_file_id`
- `telegram_file_unique_id`
- `attachment_kind`
- `caption`
- `original_file_name`
- `mime_type`
- `file_size_bytes`
- `media_group_id`
- `sort_order`
- `created_at`

Restricciones relevantes:

- `storage_chat_id + storage_message_id` unico
- indice por `entry_id`
- indice por `telegram_file_unique_id`

## Permisos

### Permisos usados

- `storage.category.manage`: crear, archivar y reactivar categorias
- `storage.entry.read`: listar, buscar y abrir entradas de una categoria
- `storage.entry.upload`: subir entradas a una categoria
- `storage.entry.manage`: borrar logicamente entradas

Los admins efectivos tienen override general mediante el sistema de autorizacion.

### Permisos por categoria

El flujo actual de `Conceder acceso` y `Revocar acceso` escribe asignaciones por recurso:

- `scopeType = resource`
- `resourceType = storage-category`
- `resourceId = <categoryId>`

Cuando se concede acceso a una categoria se aplican dos permisos:

- `storage.entry.read`
- `storage.entry.upload`

Cuando se revoca acceso se guardan con efecto `deny` esos mismos permisos.

Cada cambio deja traza en:

- `user_permission_audit_log`
- `audit_log`

## Tipos de adjunto soportados

Se indexan:

- `document`
- `photo`
- `video`
- `audio`

No se indexan actualmente:

- stickers
- voice notes
- video notes
- contactos
- ubicaciones
- encuestas
- mensajes de servicio
- texto sin adjunto

## Metadatos

### Subida directa en topic

El bot parsea el `caption` del mensaje.

Contrato actual:

- hashtags como `#rol` o `#pdf` se guardan como `tags`
- el resto del caption se guarda como `description`
- si no hay texto util, `description` queda `null`

Ejemplo:

```text
Manual revisado #rol #pdf
```

Resultado:

- `description = "Manual revisado"`
- `tags = ["rol", "pdf"]`

### Subida por DM

El flujo privado no depende del caption. El bot pregunta despues:

- descripcion opcional
- tags opcionales

## Flujos implementados para usuarios

### Abrir menu

Entrada:

- comando `/storage`
- boton `Almacenamiento` del menu principal

Condiciones:

- chat privado
- usuario aprobado
- usuario no bloqueado

Resultado:

- muestra acciones de storage segun permisos del usuario

### Listar categorias

Estado: hecho.

Usuarios normales ven:

- categorias activas
- solo categorias con permiso `storage.entry.read`

Admins ven:

- todas las categorias
- incluye archivadas

### Ver archivos por categoria

Estado: hecho.

Flujo:

- elegir `Ver archivos`
- seleccionar categoria visible
- el bot lista entradas activas de esa categoria

Limitacion:

- lista metadatos y ids, no previsualiza automaticamente adjuntos

### Buscar archivos

Estado: hecho.

Flujo:

- elegir `Buscar archivos`
- escribir query
- el bot busca en categorias visibles

Superficie de busqueda:

- `description`
- `tags`
- `original_file_name`

Limitacion:

- no hay OCR ni busqueda dentro del contenido del binario

### Abrir entrada

Estado: hecho.

Flujo:

- elegir `Abrir entrada`
- escribir id numerico
- el bot copia al privado todos los mensajes canonicos de esa entrada

Condiciones:

- la entrada existe
- la entrada esta `active`
- el usuario tiene permiso de lectura sobre la categoria
- el runtime soporta `copyMessage`

### Subir archivos por DM

Estado: hecho.

Flujo:

- elegir `Subir archivos`
- elegir categoria donde se tenga `storage.entry.upload`
- enviar uno o mas adjuntos soportados
- elegir `Terminar adjuntos`
- indicar descripcion opcional
- indicar tags opcionales
- el bot copia cada mensaje al topic canonico de la categoria
- el bot crea la entrada apuntando a los mensajes copiados

Comportamiento ante fallo:

- si falla la copia o persistencia, el bot intenta borrar copias ya realizadas
- no se crea entrada indexada parcial
- el usuario recibe error seguro

## Flujos implementados en topics

### Subida directa a topic canonico

Estado: hecho.

Flujo:

- usuario publica un adjunto soportado en un topic asociado a categoria
- el bot identifica la categoria por `chat_id + message_thread_id`
- valida usuario aprobado y no bloqueado
- valida permiso `storage.entry.upload`
- indexa el mensaje como entrada `topic_direct`

### Albums de Telegram

Estado: hecho con limitacion operativa.

Comportamiento:

- mensajes con mismo `media_group_id` se acumulan en memoria durante una ventana corta
- al cerrar la ventana, se crea una sola entrada con todos los mensajes
- antes de persistir se ordenan por `storageMessageId`
- se usa el primer caption no vacio como fuente de descripcion/tags

Limitacion:

- la agrupacion vive en memoria
- si el proceso se reinicia durante la ventana, el album puede requerir reenvio manual

## Flujos implementados para admins

### Crear categoria

Estado: hecho tecnicamente, pendiente de UX guiada.

Flujo actual:

- `slug`
- nombre visible
- descripcion opcional
- `storageChatId`
- `storageThreadId`

Problema:

- el admin debe conocer ids internos de Telegram
- es facil equivocarse de chat o topic
- el bot no valida que el chat sea supergrupo con topics
- el bot no crea el topic automaticamente

Este es el principal hueco de la feature.

### Archivar categoria

Estado: hecho.

Efecto:

- cambia `lifecycle_status` a `archived`
- deja de aparecer a usuarios normales
- deja de aceptar subidas por DM
- admins pueden seguir viendola y reactivarla

### Reactivar categoria

Estado: hecho.

Efecto:

- cambia `lifecycle_status` a `active`
- vuelve a entrar en flujos normales segun permisos

### Borrar entrada

Estado: hecho como borrado logico.

Efecto:

- cambia `lifecycle_status` a `deleted`
- no borra mensajes de Telegram
- oculta la entrada de listados, busquedas y apertura normal

### Conceder y revocar acceso

Estado: hecho.

Flujo actual:

- elegir categoria
- introducir id numerico de usuario Telegram
- validar que el usuario exista y este aprobado
- escribir permisos por recurso

Limitacion:

- no hay buscador/listado de usuarios en el flujo
- no hay pantalla de usuarios con acceso por categoria

## Que falta

### S-001. Alta guiada de categorias

Estado: pendiente.

Objetivo:

- dejar de pedir `storageChatId` y `storageThreadId` como prompts crudos
- permitir que el bot resuelva esos datos desde Telegram

Alcance recomendado para la proxima iteracion:

- boton `request_chat` para compartir el supergrupo de storage
- captura de `chat_shared` o equivalente en runtime
- validacion del chat seleccionado
- creacion automatica del topic con `createForumTopic`
- persistencia automatica de `storageChatId` y `storageThreadId`
- fallback manual asistido

### S-002. Validacion operativa del chat de storage

Estado: pendiente.

Validaciones deseadas:

- el chat compartido es supergrupo
- el chat tiene topics/foro activados
- el bot es miembro del chat
- el bot tiene permisos suficientes
- el bot puede crear topics

APIs esperadas:

- `getChat`
- `getChatMember`
- `createForumTopic`

### S-003. Pantalla de accesos por categoria

Estado: pendiente.

Objetivo:

- listar usuarios con allow/deny sobre una categoria
- facilitar auditoria y soporte operativo

Implementacion esperada:

- ampliar `StorageCategoryAccessRepository`
- consultar `user_permission_assignments`
- exponer accion admin `Ver accesos`
- mostrar permisos efectivos por usuario

### S-004. Mejor seleccion de usuarios al conceder/revocar acceso

Estado: pendiente.

Objetivo:

- no obligar a escribir ids numericos de Telegram

Implementacion esperada:

- listar usuarios aprobados paginados o filtrables
- usar botones inline o reply keyboard por nombre visible
- conservar entrada manual como fallback

### S-005. Marcado de fuente perdida

Estado: pendiente.

Objetivo:

- usar el estado `missing_source` si una entrada ya no puede servirse desde Telegram

Implementacion posible:

- capturar errores de `copyMessage` al abrir entrada
- si Telegram indica mensaje no encontrado o inaccesible, marcar entrada como `missing_source`
- avisar a admins o registrar auditoria

### S-006. Borrado fisico opcional en Telegram

Estado: pendiente y no prioritario.

Objetivo:

- permitir que un admin borre tambien los mensajes canonicos

Riesgos:

- accion destructiva
- depende de permisos del bot en el supergrupo
- puede afectar trazabilidad si se usa sin confirmacion fuerte

Recomendacion:

- mantener borrado logico como default
- si se implementa, hacerlo como accion separada con confirmacion explicita

### S-007. Indexado de contenido interno

Estado: fuera de alcance actual.

Posibles extensiones futuras:

- OCR de imagenes/PDF
- transcripcion de audio/video
- antivirus
- extraccion de texto de documentos

No debe bloquear la siguiente iteracion.

## Como completar S-001 y S-002

### Paso 1. Extender tipos de teclado para `request_chat`

Ficheros esperados:

- `src/telegram/runtime-boundary.ts`
- `src/telegram/runtime-boundary-registration.ts`
- tests en `src/telegram/runtime-boundary.test.ts`

Trabajo:

- asegurar que `TelegramReplyKeyboardButton` puede representar `requestChat`
- emitir raw `request_chat` en `toRawReplyKeyboardButton`
- usar un `request_id` estable para el flujo de storage

Nota:

- parte del soporte raw de `request_chat` ya existe en `toRawReplyKeyboardButton`; hay que verificar si cubre todos los campos necesarios y tests.

### Paso 2. Capturar `chat_shared` en el runtime

Ficheros esperados:

- `src/telegram/runtime-boundary-support.ts`
- `src/telegram/command-registry.ts`
- tests en `src/telegram/runtime-boundary.test.ts`

Trabajo:

- detectar mensajes de Telegram con `chat_shared`
- exponer en el contexto campos equivalentes a:
  - `sharedChatId`
  - `sharedChatRequestId`
  - `sharedChatTitle` si Telegram lo entrega
- hacer que `bot.onMessage` llegue al flujo de storage aunque no haya texto ni media

Resultado esperado:

- `storage-flow.ts` puede recibir la seleccion de chat durante una sesion de creacion de categoria

### Paso 3. Crear estado de sesion para seleccion guiada

Fichero principal:

- `src/telegram/storage-flow.ts`

Cambiar el flujo actual:

- de `create-category-chat-id` y `create-category-thread-id`
- a `create-category-chat-select`, `create-category-chat-validate` y `create-category-topic-create`

Datos de sesion sugeridos:

- `slug`
- `displayName`
- `description`
- `storageChatId`
- `storageChatTitle`
- `topicName`

### Paso 4. Validar el chat compartido

Ficheros esperados:

- `src/telegram/storage-flow.ts`
- posiblemente `src/telegram/runtime-boundary.ts` para exponer llamadas raw del bot

APIs:

- `getChat`
- `getChatMember`

Validaciones minimas:

- `type === 'supergroup'`
- `is_forum === true` o equivalente
- el bot es miembro/admin suficiente
- puede crear topics si el flujo automatico sera obligatorio

UX de error:

- explicar exactamente que falla
- ofrecer reintentar seleccion
- ofrecer entrada manual asistida como ultimo recurso

### Paso 5. Crear topic automaticamente

Ficheros esperados:

- `src/telegram/storage-flow.ts`
- `src/telegram/runtime-boundary-support.ts` si hace falta wrapper para `createForumTopic`

API:

- `createForumTopic`

Nombre recomendado:

- usar `displayName` de la categoria

Persistir:

- `storageChatId = chat_id` seleccionado
- `storageThreadId = message_thread_id` devuelto por Telegram

### Paso 6. Mantener fallback manual asistido

No volver al prompt crudo sin explicacion.

Fallback recomendado:

- explicar que el bot no pudo validar o crear el topic
- dar instrucciones para obtener `chat_id` y `thread_id`
- pedir ambos valores con contexto claro
- validar formato numerico
- dejar auditoria igual que en el flujo automatico

### Paso 7. Textos i18n

Fichero:

- `src/telegram/i18n-storage.ts`

Textos nuevos esperados:

- compartir supergrupo
- chat recibido
- chat invalido
- chat no es supergrupo
- chat sin topics
- bot sin permisos
- creando topic
- topic creado
- reintentar seleccion
- usar entrada manual
- instrucciones de fallback manual

### Paso 8. Tests minimos

Tests de runtime:

- serializa boton `request_chat`
- captura `chat_shared`
- entrega `sharedChatId` al contexto

Tests de storage:

- inicia creacion y pide compartir supergrupo
- rechaza chat invalido
- crea topic y guarda categoria
- cae a fallback manual si falla validacion
- mantiene el flujo manual como respaldo

Tests de regresion:

- subida por DM sigue copiando al topic
- subida directa por topic sigue indexando
- permisos de lectura/subida siguen filtrando categorias

## Orden recomendado de implementacion

1. Anadir tests de runtime para `request_chat` y `chat_shared`.
2. Implementar transporte de `chat_shared` hasta el contexto.
3. Anadir tests del nuevo flujo de creacion de categoria.
4. Cambiar `storage-flow.ts` para seleccion guiada.
5. Anadir validacion `getChat` y `getChatMember`.
6. Anadir creacion automatica de topic con `createForumTopic`.
7. Mantener fallback manual asistido.
8. Actualizar textos i18n.
9. Ejecutar `npm run typecheck` y `npm test` o al menos suites de Telegram/storage.
10. Probar manualmente en un supergrupo privado con topics activados.

## Criterios de cierre para completar Storage

La feature puede pasar de `parcial` a `operativa` cuando se cumpla:

- un admin puede crear una categoria sin conocer ids internos de Telegram
- el bot valida el supergrupo seleccionado
- el bot crea el topic automaticamente
- los errores de permisos/chat se explican claramente
- existe fallback manual asistido
- hay tests de runtime para `chat_shared`
- hay tests de flujo storage para alta guiada
- `npm run typecheck` pasa
- suite relevante de tests pasa

## Operacion actual recomendada

Mientras S-001 no este hecho:

- usar un supergrupo privado con topics activados
- crear manualmente un topic por categoria
- obtener `storageChatId` del supergrupo
- obtener `storageThreadId` del topic
- dar al bot permisos suficientes en ese supergrupo
- crear categorias desde `/storage` con esos ids
- conceder acceso por categoria desde el bot
- usar DM para subidas guiadas y el topic para subidas directas

## Limitaciones actuales aceptadas

- no hay OCR ni indexado de contenido interno
- no hay antivirus ni inspeccion profunda del archivo
- no hay sincronizacion retrospectiva de mensajes antiguos del supergrupo
- no hay Mini App ni panel web
- no hay borrado fisico automatico de mensajes canonicos
- no hay job persistente para cerrar albums tras reinicio
- no hay pantalla de accesos por categoria

## Documentacion relacionada

- `STORAGE_GROUP_IMPROVEMENT.md`: propuesta especifica para mejorar alta de categorias.
- `docs/feature-status.md`: estado global de features del bot.
- `docs/superpowers/specs/2026-04-21-telegram-storage-design.md`: diseno original de la v1 de storage.
