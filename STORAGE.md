# Storage

## Resumen

El modulo de `storage` implementa almacenamiento de archivos por categoria usando Telegram como almacenamiento canonico de binarios y PostgreSQL como indice operativo.

El sistema soporta dos vias de entrada:

- subida privada al bot por DM
- subida directa en un topic de un supergrupo privado

En ambos casos, la referencia canonica final es siempre un mensaje real de Telegram dentro del topic asociado a la categoria.

El uso operativo de storage esta pensado para usuarios aprobados.

## Arquitectura

### Binarios

- Los archivos viven en Telegram.
- Cada categoria apunta a un `storageChatId` y un `storageThreadId`.
- Ese topic es la ubicacion canonica de los adjuntos.

### Indice operativo

PostgreSQL guarda:

- categorias
- entradas
- mensajes/adjuntos de cada entrada
- permisos por categoria
- auditoria de concesion y revocacion de permisos

## Tablas principales

### `storage_categories`

Define las categorias de storage.

Campos relevantes:

- `slug`
- `display_name`
- `description`
- `storage_chat_id`
- `storage_thread_id`
- `lifecycle_status` (`active` o `archived`)

### `storage_entries`

Representa una subida logica.

Campos relevantes:

- `category_id`
- `created_by_telegram_user_id`
- `source_kind` (`dm_copy` o `topic_direct`)
- `description`
- `tags`
- `lifecycle_status` (`active`, `hidden`, `deleted`, `missing_source`)

### `storage_entry_messages`

Representa los mensajes canonicos de Telegram que pertenecen a una entrada.

Campos relevantes:

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

## Tipos de adjunto soportados

- `document`
- `photo`
- `video`
- `audio`

No se indexan en esta version:

- stickers
- voice notes
- video notes
- contactos
- ubicaciones
- encuestas
- mensajes de servicio

## Metadatos

### Descripcion y tags

En subidas directas al topic:

- el `caption` se parsea
- hashtags como `#rol` o `#pdf` se guardan como `tags`
- el resto del texto se guarda como `description`

Ejemplo:

```text
Manual revisado #rol #pdf
```

Resultado:

- `description = "Manual revisado"`
- `tags = ["rol", "pdf"]`

En subidas por DM:

- el bot pide categoria
- el usuario envia adjuntos
- luego el bot pide descripcion opcional
- luego el bot pide tags opcionales

## Flujos de usuario

### 1. Listar categorias

En privado:

- abrir `Almacenamiento`
- elegir `Listar categorias`

Usuarios normales solo ven categorias activas donde tengan permiso de lectura.

Admins ven todas las categorias, incluyendo archivadas.

### 2. Ver archivos

En privado:

- abrir `Almacenamiento`
- elegir `Ver archivos`
- elegir categoria

Se listan solo entradas activas.

### 3. Buscar archivos

En privado:

- abrir `Almacenamiento`
- elegir `Buscar archivos`
- escribir texto

La busqueda mira:

- `description`
- `tags`
- `original_file_name`

Solo devuelve entradas activas en categorias visibles para el usuario.

### 4. Abrir entrada

En privado:

- abrir `Almacenamiento`
- elegir `Abrir entrada`
- escribir el `id` numerico

El bot copia al chat privado del usuario todos los mensajes canonicos de esa entrada.

### 5. Subir archivos por DM

En privado:

- abrir `Almacenamiento`
- elegir `Subir archivos`
- elegir categoria
- enviar uno o mas adjuntos
- elegir `Terminar adjuntos`
- escribir descripcion opcional
- escribir tags opcionales

El bot copia los mensajes al topic canonico de la categoria y luego crea la entrada apuntando a esos mensajes copiados.

Si la copia o la persistencia fallan:

- el bot intenta borrar las copias ya hechas en el topic canonico
- no se crea ninguna entrada indexada
- el usuario recibe un error seguro

## Flujos de topic

### Subida directa a topic

Si un usuario publica en el topic canonico de una categoria:

- el bot identifica la categoria por `chat_id + message_thread_id`
- valida que el usuario este aprobado y no bloqueado
- valida permiso `storage.entry.upload`
- indexa el mensaje o grupo de mensajes

### Agrupacion por `media_group_id`

Los albumes de Telegram se agrupan como una sola entrada.

Comportamiento:

- los mensajes con el mismo `media_group_id` se acumulan en memoria durante una ventana corta
- al cerrar la ventana, se crea una sola entrada con todos los mensajes del album
- si hay varios captions, se usa el primer caption no vacio en orden de llegada
- antes de persistir, los mensajes se ordenan por `storageMessageId`

## Flujos admin

### Categorias

Desde `Almacenamiento`, un admin puede:

- `Crear categoria`
- `Archivar categoria`
- `Reactivar categoria`

Al crear una categoria se piden:

- `slug`
- nombre visible
- descripcion opcional
- `storageChatId`
- `storageThreadId`

### Entradas

Un admin puede:

- abrir cualquier entrada por `id`
- borrar logicamente una entrada con `Borrar entrada`

El borrado logico:

- cambia `lifecycle_status` a `deleted`
- no borra los mensajes de Telegram
- oculta la entrada de listados, busquedas y apertura normal

### Permisos por categoria

Un admin puede:

- `Conceder acceso`
- `Revocar acceso`

Actualmente este flujo aplica dos permisos de recurso sobre la categoria:

- `storage.entry.read`
- `storage.entry.upload`

Se usan asignaciones con:

- `scopeType = resource`
- `resourceType = storage-category`
- `resourceId = <categoryId>`

La concesion de acceso exige que el usuario objetivo exista y este en estado `approved`.

Cada cambio deja traza en:

- `user_permission_audit_log`
- `audit_log`

## Visibilidad y estados

### Categorias archivadas

- no aparecen para usuarios normales
- no aparecen en subidas por DM
- no aceptan nuevas entradas
- los admins si las ven en listados y pueden reactivarlas
- si una accion no tiene categorias candidatas, el flujo no se abre

### Entradas borradas logicamente

- no aparecen en listados
- no aparecen en busquedas
- no se abren por el flujo normal
- sus mensajes canonicos siguen existiendo en Telegram

## Permisos usados

### Categoria

- `storage.category.manage`

### Entradas

- `storage.entry.read`
- `storage.entry.upload`
- `storage.entry.manage`

Los admins tienen override total por el sistema general de autorizacion.

## Ficheros principales

### Dominio y persistencia

- `src/storage/storage-catalog.ts`
- `src/storage/storage-catalog-store.ts`
- `src/storage/storage-category-access-store.ts`

### Telegram

- `src/telegram/storage-flow.ts`
- `src/telegram/i18n-storage.ts`

### Schema y migracion

- `src/infrastructure/database/schema.ts`
- `drizzle/0017_flaky_satana.sql`

## Limitaciones actuales

- no hay OCR ni indexado por contenido interno del binario
- no hay antivirus ni inspeccion profunda del archivo
- la agrupacion por album usa ventana corta en memoria; no hay job persistente
- el borrado es logico, no fisico en Telegram
- no hay aun pantalla/flujo para listar explicitamente todos los usuarios con acceso a una categoria
- si el proceso se reinicia durante la ventana corta de un album, ese grupo puede requerir reenvio manual

## Operacion recomendada

- usar un supergrupo privado con topics activados
- mapear una categoria a un topic
- dar al bot permisos suficientes en ese supergrupo
- usar el bot para altas/bajas de acceso por categoria
- usar DM para subidas guiadas y el topic para subidas directas
