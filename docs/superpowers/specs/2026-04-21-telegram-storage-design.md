# Telegram Storage Design

## Goal

Anadir un modulo de almacenamiento de archivos por categoria basado en Telegram, donde los binarios vivan en Telegram y el bot mantenga un indice operativo en PostgreSQL.

La UX objetivo es:

- permitir que usuarios con permiso suban archivos a categorias
- soportar dos vias de entrada: subida directa al topic de la categoria y subida por chat privado con el bot
- permitir descripcion y tags opcionales por subida
- dejar que admins creen categorias y gestionen todos los archivos subidos
- permitir listados y busqueda por categoria desde el bot
- mantener una unica ubicacion canonica por archivo para evitar duplicidades y referencias inconsistentes

## Scope

La v1 cubre solo:

- categorias de almacenamiento asociadas a topics de un supergrupo privado
- almacenamiento canonico de adjuntos en Telegram usando mensajes reales del topic
- subida por topic directo e indexacion inmediata
- subida por chat privado al bot con copia al topic canonico antes de indexar
- descripcion opcional y tags opcionales
- listados de categorias y entradas recientes
- busqueda por texto y tags sobre metadatos indexados
- gestion administrativa de categorias, permisos y entradas indexadas
- borrado logico de entradas en el indice
- trazabilidad basica en `audit_log`

La v1 no cubre:

- indexado por contenido interno del binario, OCR, transcripcion o antivirus
- moderacion previa a la publicacion
- subida via Mini App o panel web
- descarga del binario para transformaciones o reprocesado
- borrado fisico automatico del mensaje canonico en Telegram al borrar una entrada
- sincronizacion retrospectiva de todo el historial antiguo del supergrupo
- canal espejo, feed publico o replicacion adicional fuera del supergrupo canonico

## Current Project Context

El proyecto ya tiene piezas que encajan bien con este modulo:

- `src/telegram/runtime-boundary-support.ts` ya abstrae comandos, callbacks y envio de mensajes sobre `grammY`
- `src/telegram/conversation-session.ts` ya resuelve sesiones conversacionales por chat y usuario para el flujo privado
- `src/infrastructure/database/schema.ts` ya concentra el schema Drizzle del sistema
- `src/telegram/action-menu.ts` y `src/telegram/runtime-boundary-registration.ts` ya exponen secciones privadas y acciones admin en el bot
- `src/membership/*` y el modelo de permisos existente ya permiten reglas globales y por recurso
- `audit_log` y `user_permission_audit_log` ya proporcionan trazabilidad operativa coherente con nuevas capacidades administrativas

Tambien hay restricciones reales de Bot API publica que condicionan el disenio:

- el bot no debe depender de descargar archivos grandes para poder indexarlos
- el bot no debe depender de volver a subir binarios para servir resultados
- la referencia mas estable para una entrada debe ser `chat_id + message_id` del mensaje canonico en Telegram

## Approaches Considered

### 1. Solo topics y metadatos embebidos en captions

Ventaja: menos tablas nuevas y menos trabajo de indexacion.

Inconveniente: la busqueda, la gestion administrativa y los permisos quedan demasiado limitados para la funcionalidad pedida.

### 2. Supergrupo canonico con topics por categoria e indice en PostgreSQL

Ventaja: mantiene los binarios en Telegram, unifica las dos vias de subida y permite permisos, busqueda y gestion admin con un modelo claro.

Inconveniente: requiere varias tablas nuevas y logica de indexacion por mensaje.

### 3. Doble almacenamiento con supergrupo y canal espejo

Ventaja: permite separar almacenamiento operativo y presentacion de lectura.

Inconveniente: duplica mensajes y complica la consistencia sin aportar valor claro a la v1.

La opcion recomendada es la 2.

## Recommended Architecture

### 1. Canonical Storage Chat

El sistema tendra un unico supergrupo privado de almacenamiento con `topics` activados.

Cada categoria de almacenamiento se vincula a un `message_thread_id` de ese supergrupo. Ese topic es la ubicacion canonica de todos los mensajes que pertenecen a la categoria.

Regla central de la v1:

- toda entrada indexada debe apuntar a mensajes canonicos del topic de su categoria
- las subidas por DM nunca se sirven desde el mensaje privado original
- si la subida nace en DM, el bot primero copia al topic y solo despues indexa
- si la subida nace en el topic, ese mismo mensaje pasa a ser canonico

Esto unifica listados, permisos, administracion y resolucion posterior de resultados.

### 2. Split By Responsibility

Se recomienda seguir el reparto ya usado en otras capacidades del bot:

- modulo de dominio para reglas de categorias, entradas, permisos y busqueda
- store dedicado para persistencia Drizzle
- capa Telegram para flujos, teclados, parseo de captions y presentacion

Modulos orientativos:

- `src/storage/storage-catalog.ts`
- `src/storage/storage-catalog-store.ts`
- `src/telegram/storage-flow.ts`
- `src/telegram/storage-keyboards.ts`
- `src/telegram/storage-presentation.ts`
- `src/telegram/i18n-storage.ts`

### 3. Supported Telegram Messages

La v1 indexa solo mensajes con media soportada. Tipos soportados:

- `document`
- `photo`
- `video`
- `audio`

La v1 no indexa:

- stickers
- voice notes
- video notes
- contactos
- ubicaciones
- polls
- mensajes de servicio

Una entrada debe contener al menos un mensaje con media soportada. Una entrada puede contener multiples mensajes.

### 4. Caption Metadata Contract

Para subidas directas al topic, la descripcion y los tags se extraen del `caption`.

Contrato explicito de v1:

- cualquier palabra que empiece por `#` y contenga letras, numeros, `_` o `-` se considera tag
- los tags se normalizan a minusculas y sin duplicados
- el resto del caption, tras eliminar esos tags y limpiar espacios sobrantes, se guarda como descripcion
- si el caption no contiene texto util, la descripcion queda `null`

Ejemplo:

```text
Manual revisado de la campaña #rol #fantasy #pdf
```

Resultado:

- descripcion: `Manual revisado de la campaña`
- tags: `['rol', 'fantasy', 'pdf']`

En subidas por DM, el flujo privado puede recoger descripcion y tags por pasos separados y no depende de parsear hashtags.

## Data Model

### 1. Storage Categories

Nueva tabla `storage_categories`:

- `id`
- `slug`
- `displayName`
- `description` nullable
- `storageChatId`
- `storageThreadId`
- `lifecycleStatus`: `active | archived`
- `createdAt`
- `updatedAt`
- `archivedAt` nullable

Reglas:

- `slug` unico y estable
- `storageChatId + storageThreadId` unico para evitar dos categorias sobre el mismo topic
- una categoria archivada no acepta nuevas subidas ni aparece en listados normales de usuario

### 2. Storage Entries

Nueva tabla `storage_entries`:

- `id`
- `categoryId`
- `createdByTelegramUserId`
- `sourceKind`: `topic_direct | dm_copy`
- `description` nullable
- `tags` jsonb
- `lifecycleStatus`: `active | hidden | deleted | missing_source`
- `createdAt`
- `updatedAt`
- `deletedAt` nullable
- `deletedByTelegramUserId` nullable

La tabla representa la subida logica compartida por uno o varios mensajes canonicos.

### 3. Storage Entry Messages

Nueva tabla `storage_entry_messages`:

- `id`
- `entryId`
- `storageChatId`
- `storageMessageId`
- `storageThreadId`
- `telegramFileId` nullable
- `telegramFileUniqueId` nullable
- `attachmentKind`
- `caption` nullable
- `originalFileName` nullable
- `mimeType` nullable
- `fileSizeBytes` nullable
- `mediaGroupId` nullable
- `sortOrder`
- `createdAt`

Reglas:

- unicidad por `storageChatId + storageMessageId`
- indice por `telegramFileUniqueId` para diagnostico y posibles deduplicaciones futuras
- `sortOrder` mantiene el orden visible de la subida

### 4. Indices And Search Surface

La v1 buscara sobre:

- `storage_categories.displayName`
- `storage_entries.description`
- `storage_entries.tags`
- `storage_entry_messages.originalFileName`

No se indexa contenido interno del binario.

### 5. Audit Trail

Cada accion administrativa relevante debe dejar evento en `audit_log`, incluyendo como minimo:

- categoria creada
- categoria archivada o reactivada
- permisos concedidos o revocados para categoria
- entrada borrada logicamente
- entrada marcada como `missing_source`

## Permissions Model

La v1 reaprovecha el sistema actual de permisos por recurso.

Claves de permiso propuestas:

- `storage.category.manage`
- `storage.entry.upload`
- `storage.entry.read`
- `storage.entry.manage`

Modelo:

- los admins efectivos pueden hacer todo
- los permisos por categoria usan `scopeType = 'resource'`
- `resourceType = 'storage-category'`
- `resourceId = <categoryId>`

Reglas practicas de v1:

- crear o archivar categorias requiere `storage.category.manage`
- subir a una categoria requiere `storage.entry.upload` en esa categoria
- ver una categoria o buscar dentro requiere `storage.entry.read` en esa categoria
- borrar logicamente o gestionar entradas requiere `storage.entry.manage` en esa categoria

No se introduce una regla implicita de lectura global para usuarios aprobados. El acceso debe ser explicito por categoria o por admin override.

## Data Flow

### Flow 1: Upload By DM

1. El usuario abre la seccion de almacenamiento en privado.
2. El bot lista las categorias donde el usuario tiene `storage.entry.upload`.
3. El usuario elige categoria.
4. El bot inicia una sesion de subida con TTL normal del proyecto.
5. El usuario envia uno o varios mensajes con media soportada.
6. El bot acumula referencias temporales de esos mensajes en la sesion.
7. El bot pide descripcion y tags opcionales.
8. Al confirmar, el bot copia cada mensaje al topic canonico de la categoria.
9. Si todas las copias salen bien, crea `storage_entries` y `storage_entry_messages` apuntando a los mensajes copiados.
10. Si alguna copia falla, aborta la operacion y no persiste una entrada parcial.

La unidad de persistencia de este flujo es toda la subida confirmada, no cada mensaje por separado.

### Flow 2: Direct Upload In Topic

1. El usuario publica un mensaje con media soportada en el topic de una categoria.
2. El bot resuelve la categoria por `chat_id + message_thread_id`.
3. Valida que la categoria este activa y que el usuario tenga `storage.entry.upload`.
4. Si el mensaje trae `media_group_id`, espera a completar la agrupacion logica de ese grupo antes de persistir la entrada.
5. Extrae descripcion y tags del caption segun el contrato definido.
6. Crea `storage_entry` y una o varias filas en `storage_entry_messages`.

Regla de agrupacion de v1:

- mensajes con el mismo `media_group_id` dentro del mismo topic se agrupan en una sola entrada
- mensajes sin `media_group_id` generan una entrada independiente por mensaje
- el cierre del grupo se resuelve con una ventana corta en memoria, por ejemplo de pocos segundos, sin introducir jobs en background
- si un album aporta mas de un caption no vacio, se usa el primer caption no vacio en orden de llegada como fuente de descripcion y tags

### Flow 3: Listing Categories And Entries

Desde privado, el usuario puede:

- listar categorias visibles
- abrir una categoria
- ver entradas recientes paginadas
- abrir el detalle resumido de una entrada

El detalle resumido debe incluir:

- categoria
- descripcion si existe
- tags si existen
- numero de mensajes adjuntos
- autor
- fecha

La entrega del contenido al usuario se hace copiando de nuevo los mensajes canonicos al chat privado del usuario cuando solicite una entrada concreta.

### Flow 4: Search

La busqueda se ejecuta solo sobre categorias donde el usuario tenga `storage.entry.read`.

Consultas soportadas en v1:

- texto libre sobre descripcion y nombre de archivo
- filtro por tag
- combinacion de categoria + texto

No se soportan en v1:

- busquedas booleanas avanzadas
- ordenaciones arbitrarias fuera de recientes y relevancia simple
- facetado complejo

### Flow 5: Admin Management

Los admins o usuarios con permiso de gestion pueden:

- crear categoria y vincularla a un topic existente
- archivar o reactivar categoria
- revisar entradas de cualquier categoria accesible
- borrar logicamente una entrada
- marcar una entrada rota como `missing_source`
- gestionar permisos de lectura, subida y gestion por categoria

El borrado inicial de v1 es logico en BD. El mensaje de Telegram no se borra automaticamente para evitar operaciones destructivas involuntarias.

## Error Handling

- si una subida por DM no tiene ningun mensaje con media soportada, no se puede confirmar
- si una categoria esta archivada, se rechazan nuevas subidas tanto por DM como por topic
- si un usuario publica en un topic sin permiso, el bot no indexa el mensaje
- si el caption contiene tags mal formados, solo se indexan los tags validos; la entrada no falla por eso
- si una copia desde DM falla a mitad, no se persiste la entrada y el usuario recibe un error de operacion incompleta
- si al servir una entrada el mensaje canonico ya no existe o no puede copiarse, la entrada puede pasar a `missing_source`
- si un mismo mensaje del topic llega dos veces por reintento o update repetido, la unicidad por `storageChatId + storageMessageId` evita duplicados persistidos

## Testing

La implementacion debe seguir TDD y cubrir, como minimo:

### 1. Domain Tests

- creacion y archivado de categorias
- autorizacion por categoria
- creacion de entradas con uno o varios mensajes
- agrupacion por `media_group_id`
- normalizacion de tags y descripcion desde caption
- transicion a `deleted` y `missing_source`

### 2. Store Tests

- indices unicos de categorias y mensajes
- consultas de listado por categoria
- consultas de busqueda por texto y tags
- filtrado por permisos visibles

### 3. Telegram Flow Tests

- subida por DM con uno y varios mensajes
- cancelacion de sesion de subida por DM
- subida directa a topic con media soportada
- rechazo por categoria archivada
- rechazo por falta de permiso
- agrupacion correcta de albumes por `media_group_id`
- resolucion de detalle copiando mensajes canonicos al chat privado

## Implementation Notes

Para mantener el alcance pequeno y consistente con el repo actual:

- la primera integracion debe vivir solo en chat privado para listados, busqueda y administracion
- la indexacion por topic debe ser reactiva a updates entrantes, sin jobs en background
- los mensajes canonicos del topic son la unica fuente de verdad para servir archivos despues
- la capa Telegram no debe asumir que puede descargar binarios grandes ni inspeccionar su contenido

## Recommendation Summary

La v1 debe implementarse sobre un supergrupo privado con topics como almacenamiento canonico, PostgreSQL como indice operativo y dos vias de subida que convergen siempre en el mismo mensaje canonico del topic.

Este diseno minimiza dependencia de los limites mas problematicos de Bot API publica, mantiene una sola referencia estable por archivo y encaja con la arquitectura actual del proyecto basada en sesiones, dominio separado y permisos por recurso.
