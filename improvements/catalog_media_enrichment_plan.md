# Goal: completar media e integraciones del Catálogo

## Estado actual

El catálogo ya permite CRUD de items, familias/grupos, búsqueda, préstamos desde el detalle, importación individual y masiva, importación de colecciones BGG, Open Library para libros/RPG y detección de título desde portada con OpenCode.

Los huecos a cerrar son:

- No hay acción visible para añadir una imagen/media nueva a un item ya existente desde Telegram.
- La media del catálogo se guarda solo como URL; no hay flujo para adjuntar una foto/documento de Telegram a un item ni para reutilizar la infraestructura real de `Storage`.
- `docs/feature-status.md` aún describe BGG como asistido/parcial, aunque BGG ya funciona como fuente principal cuando hay `bgg.apiKey`, con Wikipedia como fallback.
- Open Library aporta pocos campos para libros/RPG; se intentará enriquecer lo que sea razonable sin bloquear el goal si la API no lo permite.
- La portada usada para detectar el título puede estar mal encuadrada o no ser la portada real; si se ofrece guardarla como foto del artículo, debe requerir confirmación explícita del usuario.

## Alcance

1. Añadir una acción admin para incorporar imagen/media a un item existente.
2. Soportar dos entradas para esa acción:
   - URL manual.
   - Adjunto Telegram (`photo` o documento con MIME `image/*`).
3. Guardar las imágenes reales usando la misma estructura que `Storage`: un topic/categoría técnica interna dentro del supergrupo de Storage por defecto.
4. Intentar importar automáticamente imágenes de BGG/Open Library/servicios externos usados durante la importación de metadatos.
5. Actualizar la documentación del estado del catálogo para reflejar que BGG ya está operativo como fuente principal si está configurado.
6. Mejorar, si es posible, el enriquecimiento de libros/RPG con campos adicionales desde Open Library u otra respuesta ya accesible sin introducir un flujo externo complejo.
7. Al usar una imagen de portada para detectar título durante el alta, preguntar si se quiere guardar esa misma imagen como media del item antes de asociarla.
8. Propagar la portada principal del artículo en los avisos de préstamos publicados en grupos de noticias.

## Comportamiento esperado

### Añadir imagen/media a item existente

- En el detalle admin de un item debe aparecer una acción visible `Añadir media` o equivalente localizado.
- Al pulsarla, el bot pregunta el origen:
  - `URL`
  - `Adjunto`
  - `Cancelar`
- Si el admin elige URL:
  - El flujo pide la URL.
  - Pide texto alternativo opcional.
  - Pide orden opcional.
  - Muestra resumen y confirma antes de guardar.
  - Intenta importar la imagen al topic interno de Storage enviando la URL a Telegram como foto/documento, si el runtime lo soporta.
  - Si la importación al topic funciona, crea una entrada de Storage y guarda en `catalog_media` un enlace estable a esa entrada.
  - Si Telegram no acepta la URL o el runtime no soporta el envío necesario, guarda la URL externa en `catalog_media` como fallback y lo indica al admin.
- Si el admin elige adjunto:
  - El bot pide enviar foto o documento de imagen.
  - Si el adjunto no es imagen, responde con error útil y mantiene el flujo.
  - Copia el mensaje al topic interno de Storage con `copyMessage`/`forwardMessage`, igual que hace Storage para subidas por DM.
  - Crea una entrada de Storage con descripción/tags técnicos del item.
  - Guarda en `catalog_media` un enlace estable a esa entrada, por ejemplo `storage:entry:<entryId>` o el formato equivalente elegido.
  - Guarda alt y orden como en URL.
- Al terminar, audita `catalog.media.created` y vuelve al menú o al detalle del item.

### Backend Storage para imágenes de catálogo

- El sistema debe crear o reutilizar una categoría técnica interna de Storage para imágenes de catálogo.
- Esa categoría debe vivir en el supergrupo de Storage por defecto vigente.
- Si no existe, el bot debe crear un topic nuevo en el supergrupo por defecto con un nombre claro, por ejemplo `Catalog media` / `Imágenes de catálogo`.
- La categoría debe ser interna: no debe aparecer como categoría normal en `/storage` para socios, ni mezclarse con categorías públicas de archivos.
- Si el modelo actual de Storage no soporta categorías internas, añadir una marca explícita y testeada, por ejemplo `visibility: public | internal` o `purpose: user_uploads | catalog_media`, en vez de depender solo del nombre o del slug.
- Las entradas internas deben poder seguir usando `storage_entries` y `storage_entry_messages` para tener `storageChatId`, `storageThreadId`, `storageMessageId`, `telegramFileId`, MIME, tamaño y auditoría operativa.
- `catalog_media` debe seguir siendo la tabla que une una media con un item de catálogo, pero su `url` puede apuntar a una entrada Storage (`storage:entry:<id>`) cuando la imagen está bajo control del bot.
- La lectura del catálogo debe poder resolver ese enlace Storage para mostrar/copiar la imagen si ya existe soporte suficiente; si no, debe al menos mostrar la referencia sin romper el detalle.
- La primera imagen principal de un item debe representar siempre la portada. Para ello:
  - las portadas importadas desde BGG/Open Library deben guardarse con `sortOrder: 0`;
  - si el usuario guarda manualmente una portada, debe poder quedar como principal;
  - otras imágenes del item deben tener orden posterior;
  - si se edita el orden, el bot debe dejar claro que la imagen con orden `0` se usará como portada principal.

### Portada detectada durante alta

- Cuando el paso de nombre recibe una portada y OpenCode detecta el título, el flujo sigue usando ese título para buscar/importar metadatos.
- Después de crear el item, si existe una imagen de portada candidata, el bot debe preguntar:
  - `Guardar como foto`
  - `No guardar`
- Solo si el admin confirma, se crea `catalog_media` para el item.
- Si confirma, se copia la portada al topic interno de Storage y `catalog_media` apunta a esa entrada.
- Si el alta no termina creando item, no se guarda media.
- Si el adjunto no puede guardarse como media, el alta no debe fallar por eso; se informa y se mantiene creado el item.

### Importación automática de imágenes externas

- Cuando BGG devuelva imagen o miniatura para un juego/expansión, el flujo de alta debe intentar importarla automáticamente al Storage interno.
- Cuando Open Library devuelva portada para libros/RPG, el flujo debe intentar importarla automáticamente al Storage interno.
- La importación automática debe ser best-effort:
  - Si la imagen externa se importa correctamente, se crea `catalog_media`.
  - Si falla por URL rota, timeout, tamaño, permisos o limitación del runtime, se conserva el item importado y se registra/explica el fallo de media sin bloquear el alta.
- Si el usuario también aportó una portada manual, no duplicar imágenes a ciegas:
  - priorizar confirmación del usuario para la portada manual;
  - usar la imagen externa como fallback si no se guarda la manual;
  - evitar duplicados por URL, `telegramFileUniqueId` o entrada Storage cuando sea posible.

### Portada en avisos de préstamos

- Los avisos de grupos de noticias del tipo "X usuario ha tomado prestado X juego/libro" deben intentar incluir una imagen.
- Solo se enviará una imagen: la portada principal del item.
- La portada principal se resuelve como la media `image` activa del item con menor `sortOrder`, idealmente `0`.
- Si la media principal apunta a `storage:entry:<id>`, el bot debe copiar o reenviar el primer mensaje de imagen de esa entrada Storage al grupo de noticias.
- Si la media principal es una URL externa, el bot puede intentar enviarla como imagen si el runtime lo soporta; si no, mantiene el mensaje textual actual.
- Si no hay portada o falla el envío de imagen, el aviso textual debe seguir enviándose sin bloquear la publicación.
- En la primera versión basta con aplicar esto a avisos de préstamo; las devoluciones pueden mantenerse solo texto salvo que el cambio sea trivial y consistente.

### Documentación BGG

- `docs/feature-status.md` debe dejar de presentar BGG como incompleto si el código ya lo usa como fuente principal con `bgg.apiKey`.
- El resumen ejecutivo debe mantener el formato de tabla de texto ancho fijo.
- La sección `Catalogo` debe reflejar:
  - BGG individual operativo para juegos de mesa cuando hay API key.
  - Wikipedia como fallback.
  - BGG collection import operativo.
  - OpenCode solo detecta título visible desde imagen, no metadatos completos.

### Enriquecimiento de libros/RPG

- Revisar `src/catalog/catalog-lookup-service.ts`.
- Intentar añadir campos disponibles de forma razonable:
  - portada de Open Library si hay `cover_i`, `cover_edition_key` o ISBN utilizable.
  - descripción solo si puede obtenerse con una llamada simple y estable.
  - autores más completos en `metadata`.
  - enlaces Open Library más útiles en `externalRefs`.
- Si Open Library no ofrece datos fiables sin encadenar demasiadas llamadas o añadir fragilidad, documentar la limitación y no bloquear el goal.

## Diseño técnico orientativo

Archivos probables:

- `src/telegram/catalog-admin-detail-buttons.ts`
- `src/telegram/catalog-admin-callback-routing.ts`
- `src/telegram/catalog-admin-callback-sessions.ts`
- `src/telegram/catalog-admin-media-flow.ts`
- `src/telegram/catalog-admin-support.ts`
- `src/telegram/catalog-admin-keyboards.ts`
- `src/telegram/i18n-catalog-admin.ts`
- `src/telegram/storage-flow.ts`
- `src/storage/storage-catalog.ts`
- `src/storage/storage-catalog-store.ts`
- `src/infrastructure/database/schema.ts`
- `src/catalog/catalog-lookup-service.ts`
- `src/catalog/wikipedia-boardgame-import-service.ts`
- `src/telegram/catalog-loan-flow.ts`
- `src/news/news-group-catalog.ts` o el publicador concreto usado por préstamos, si aplica
- `src/telegram/catalog-admin-flow.test.ts`
- `src/telegram/catalog-loan-flow.test.ts`
- `src/telegram/storage-flow.test.ts`
- `src/storage/storage-catalog.test.ts`
- `src/storage/storage-catalog-store.test.ts`
- `src/catalog/catalog-lookup-service.test.ts`
- `docs/feature-status.md`

Reutilizar el flujo existente de media en vez de crear otro paralelo. Ahora ya existe lógica para editar/borrar media y funciones de crear media, pero falta el punto de entrada visible para crear media desde un item existente.

Para adjuntos Telegram, preferir copiar/reenviar al topic interno de Storage y persistir una `storage_entry` antes que guardar solo `file_id` en `catalog_media`. El `file_id` queda persistido dentro de `storage_entry_messages`.

Para la portada detectada, extender los datos temporales del flujo de alta con la referencia al adjunto candidato. El guardado debe ocurrir después de crear el item, nunca antes.

Para imágenes externas, revisar si el runtime necesita una operación nueva (`sendPhoto` por URL o `sendDocument` por URL) además de las ya existentes (`copyMessage`, `forwardMessage`, `sendMediaGroup`, `sendDocument` con fichero local). Si hace falta, añadirla en `runtime-boundary-support.ts` y pasarla por `runtime-boundary-middleware.ts`, con reintentos Telegram centralizados.

## Plan de ejecución

1. Auditar el flujo actual de media
   - Confirmar cómo se enrutan callbacks de media.
   - Confirmar cómo se renderiza media en detalle admin y lectura.
   - Identificar si conviene volver al detalle del item tras guardar.

2. Añadir creación de media desde item existente
   - Añadir callback `catalog_admin:add_media:<itemId>`.
   - Mostrar botón solo a admins.
   - Crear sesión `catalog-admin-media` en modo creación con `itemId`.
   - Añadir opción de origen URL/adjunto.
   - Mantener compatibilidad con el flujo actual de edición.

3. Preparar Storage interno para catálogo
   - Crear una marca de categoría interna si el modelo no la tiene.
   - Crear/resolver la categoría técnica de imágenes de catálogo.
   - Crear topic en el supergrupo de Storage por defecto cuando falte.
   - Excluir categorías internas de la navegación normal de `/storage`.
   - Añadir helpers reutilizables para persistir una imagen de catálogo como `storage_entry`.

4. Soportar adjuntos como media
   - Leer `context.messageMedia` durante la sesión.
   - Aceptar `photo` y documentos `image/*`.
   - Rechazar otros adjuntos con mensaje claro.
   - Copiar/reenviar el adjunto al topic interno.
   - Crear `storage_entry` y `catalog_media` enlazada.
   - Cubrir auditoría y tests.

5. Soportar URL e importación externa como media
   - Añadir envío de imagen externa al topic interno, con fallback a URL si Telegram no puede importarla.
   - Extraer imagen/thumbnail de BGG individual y colección si la respuesta lo trae.
   - Extraer portada Open Library cuando exista.
   - Crear `catalog_media` automáticamente solo si la importación de imagen funciona o si se acepta el fallback URL.
   - Guardar portadas importadas con `sortOrder: 0` cuando el item no tenga portada previa.

6. Confirmar guardado de portada detectada
   - Persistir temporalmente el adjunto usado para detectar título.
   - Tras creación/importación del item, preguntar si se guarda como foto.
   - Crear media solo con confirmación explícita.
   - Si se guarda como portada principal, usar `sortOrder: 0` y desplazar/ordenar otras imágenes si hace falta.
   - No bloquear el alta si falla el guardado de media.

7. Propagar portada en avisos de préstamos
   - Localizar el publicador actual de noticias de préstamos.
   - Resolver media principal del item antes de publicar.
   - Copiar/reenviar una sola imagen desde Storage si existe.
   - Mantener fallback textual si no hay portada o falla el envío.
   - Añadir tests de envío con portada y fallback sin portada.

8. Actualizar BGG en documentación
   - Corregir resumen ejecutivo y sección `Catalogo`.
   - Reflejar BGG principal + Wikipedia fallback.
   - Mantener el formato obligatorio de tabla de texto.

9. Intentar enriquecimiento Open Library
   - Añadir campos simples y testeables si la API ya los entrega.
   - Si requiere llamadas adicionales frágiles, dejar nota en `docs/feature-status.md` y cerrar como limitación aceptada.

10. Validación final
   - Ejecutar tests focalizados.
   - Ejecutar typecheck/lint si aplica.
   - Ejecutar `./scripts/feature-status-audit.sh`.
   - Ejecutar `./startup.sh`.

## Tests mínimos

- `catalog-admin-flow.test.ts`
  - El detalle admin muestra `Añadir media`.
  - Un socio no admin no ve ni puede ejecutar acciones admin de media.
  - Crear media por URL persiste `catalog_media` y audita `catalog.media.created`.
  - Crear media por adjunto acepta foto/documento imagen.
  - Crear media por adjunto rechaza documento no imagen.
  - Crear media por adjunto crea o reutiliza entrada Storage interna.
  - Una imagen externa de BGG/Open Library crea media automáticamente cuando se puede importar.
  - La primera portada creada queda con `sortOrder: 0`.
  - Cambiar la portada principal deja una sola imagen principal clara.
  - Si falla la importación automática de imagen, el item sigue creado.
  - La portada usada para detectar título pide confirmación antes de guardarse.
  - Si el usuario elige no guardar portada, no se crea media.
- `catalog-loan-flow.test.ts`
  - Un préstamo publicado en grupo intenta enviar la portada principal cuando existe.
  - Solo se envía una imagen aunque el item tenga varias.
  - Si el envío de la imagen falla, se envía el aviso textual actual.
  - Si no hay portada, se mantiene el comportamiento textual actual.
- `storage-flow.test.ts` / `storage-catalog*.test.ts`
  - Las categorías internas no aparecen en la navegación normal de Storage.
  - La categoría interna de catálogo se crea en el supergrupo por defecto.
  - Una entrada interna mantiene `storageChatId`, `storageThreadId` y mensajes igual que una subida normal.
- `catalog-lookup-service.test.ts`
  - Cubre cualquier campo nuevo de Open Library.
- Mantener tests existentes de edición/borrado de media.

## Validación manual en Telegram

1. Abrir `/catalog` como admin.
2. Ir a un item existente.
3. Pulsar `Añadir media`.
4. Probar URL y comprobar que el detalle muestra la media.
5. Repetir con foto adjunta.
6. Comprobar en el supergrupo de Storage que existe el topic interno de catálogo y que recibe las imágenes.
7. Abrir `/storage` como socio y confirmar que la categoría interna no aparece como categoría pública.
8. Crear/importar un juego con BGG y comprobar que intenta traer imagen externa.
9. Crear/importar un libro/RPG con Open Library y comprobar si trae portada.
10. Crear un item desde portada.
11. Confirmar que el bot detecta el título, crea/importa el item y pregunta si se guarda la imagen.
12. Probar `Guardar como foto` y `No guardar`.
13. Tomar prestado un item con portada y comprobar que el grupo de noticias recibe el aviso con una sola imagen.
14. Tomar prestado un item sin portada y comprobar que el aviso textual sigue funcionando.

## Criterios de cierre

- La acción para añadir media existe desde el detalle admin de un item.
- Se puede añadir imagen por URL.
- Se puede añadir imagen por adjunto Telegram.
- Las imágenes adjuntas y las importadas se almacenan en un topic/categoría interna de Storage cuando sea posible.
- La categoría interna no contamina la navegación normal de Storage.
- BGG/Open Library intentan importar imágenes externas automáticamente sin bloquear el alta si fallan.
- Cada item puede tener una portada principal clara, representada por la primera imagen (`sortOrder: 0`).
- Los avisos de préstamo en grupos de noticias incluyen una única portada cuando existe y mantienen fallback textual cuando no existe o falla el envío.
- El guardado de portada detectada requiere confirmación explícita.
- La documentación deja claro que BGG está funcional como fuente principal configurada.
- Las mejoras Open Library posibles están implementadas o documentadas como limitación.
- Tests focalizados pasan.
- `./scripts/feature-status-audit.sh` pasa.
- `./startup.sh` pasa.

## Fuera de alcance

- Almacenamiento físico propio de binarios fuera de Telegram o fuera del supergrupo de Storage.
- Migrar media histórica.
- Galería avanzada con previews enriquecidos.
- OCR o validación visual de que la portada corresponde al item.
- Rehacer nombres internos como `wikipedia-boardgame-import-service.ts`, salvo que sea imprescindible para la mejora.
