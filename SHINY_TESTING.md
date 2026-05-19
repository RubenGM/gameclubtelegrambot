# Shiny Testing - mejoras UX Storage

Fecha de origen: 2026-05-18.

Este documento resume pain points detectados durante una prueba manual de Storage con una persona tester. La conversacion se centro en subida por privado, eleccion de categoria, tags y busqueda. La intencion es usarlo como base para un `/goal` y corregir el flujo completo, no aplicar parches aislados.

## Conversacion resumida

- La tester no sabia que accion tocaba hacer tras enviar adjuntos.
- En Telegram Web no se abria automaticamente el teclado persistente, asi que los botones de accion quedaban ocultos en el icono lateral.
- No quedaba claro como confirmar que una categoria era el destino de subida.
- Habia dudas reales sobre cuando crear categorias y cuando usar tags.
- El bot pedia tags con formato `#tag`, pero la tester probo formatos mas naturales como palabras sueltas o separadas por comas.
- Al no pedir tags de forma activa, la tester entendio que el bot habia seguido adelante sin darle oportunidad clara.
- La busqueda de Storage no comunicaba bien que se podia escribir cualquier texto, categoria o tag.
- La pantalla de busqueda lista categorias de golpe, lo que ya resulta largo y puede escalar mal con muchas categorias.

## Objetivo de producto

Hacer que una persona que no conoce la implementacion pueda:

1. Subir archivos por privado.
2. Elegir una categoria destino sin depender de que Telegram Web abra el teclado.
3. Entender que puede guardar en la categoria actual.
4. Añadir tags sin aprender una sintaxis estricta.
5. Buscar por nombre, categoria o tag sin tener que descubrirlo por ensayo y error.
6. Explorar categorias sin recibir listas enormes cuando queria buscar.

## Mejoras propuestas

### 1. Hacer visible la confirmacion de subida

Pain point:

La tester llego a la vista previa pero no veia claramente los botones. En Telegram Web el teclado persistente no siempre se despliega solo.

Cambio propuesto:

- Mantener el teclado persistente actual para compatibilidad.
- Añadir botones inline en la propia vista previa: `Completar`, `Añadir tags`, `Editar descripcion`, `Añadir imagenes`, `Cancelar`.
- Renombrar `Aceptar` a `Completar` o `Guardar` para que la accion sea menos ambigua.
- Reforzar el texto de la vista previa con una instruccion final: "Pulsa Completar para guardar estos archivos. Puedes añadir tags o editar la descripcion antes."

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - `handleActiveUploadFlow(...)`, rama `session.stepKey === 'upload-preview'`: procesa `texts.uploadAccept`, `texts.uploadModifyDescription`, `texts.addTagsButton`, `texts.addImages`.
  - `formatUploadPreview(...)`: construye el mensaje de vista previa.
  - `buildUploadPreviewOptions(...)`: localizar funcion para teclado actual de preview.
- `src/telegram/i18n-storage.ts`
  - `uploadAccept`, `uploadModifyDescription`, `uploadPreviewHeader`, `invalidUploadPreviewAction`.
- `src/telegram/storage-flow.test.ts`
  - Test principal: `handleTelegramStorageText collects a DM upload, copies it to the category topic and persists it`.
  - Añadir/assertar inline keyboard o texto explicito en la preview.

Notas:

- Si se introducen inline buttons, hay que revisar `handleTelegramStorageCallback(...)` y `storageCallbackPrefixes` para callbacks nuevos o reutilizables.
- El patron debe respetar la regla existente: si el texto ya tiene enlaces de navegacion, no duplicar navegacion con botones. Aqui los botones son acciones de confirmacion, no navegacion redundante.

### 2. Aclarar la seleccion de categoria destino

Pain point:

La tester preguntó "yo ahora como le digo que lo suelte aqui?". El boton `Seleccionar ...` existe, pero no era suficientemente evidente.

Cambio propuesto:

- En prompts de seleccion, explicar dos acciones distintas:
  - "Pulsa una subcategoria para entrar."
  - "Pulsa Seleccionar esta categoria para guardar aqui."
- Usar un texto de boton consistente y contextual: `Seleccionar esta categoria` o `Guardar aqui`.
- Si se esta en una categoria durante una subida, mostrar el destino actual de forma destacada.

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - Rama `if (text === texts.upload)`: arranca `storage-upload` con `stepKey: 'upload-category'` y muestra categorias.
  - `handleActiveUploadFlow(...)`, rama `session.stepKey === 'upload-category'`: resuelve la categoria seleccionada.
  - `formatMoveEntryCategoryPrompt(...)`: mensaje de seleccion nivel a nivel reutilizable para mostrar categoria actual, hijas y accion `Seleccionar ...`.
  - `formatStorageCategoryListMessage(...)` y `formatStorageCategoryLinks(...)`: enlaces de categorias en modo `select`.
  - Rutas `storage_select_category_*` en `handleTelegramStorageStartText(...)` y `handleStorageCategoryCallback(...)`.
- `src/telegram/i18n-storage.ts`
  - `askUploadCategory`.
  - `selectCurrentMoveCategory`.
  - Probable nuevo texto para seleccionar categoria actual en subida.
- `src/telegram/storage-flow.test.ts`
  - Tests cerca de seleccion de categoria y subida por privado.
  - Tests de movimientos nivel a nivel pueden servir como referencia para el patron `Seleccionar ...`.

### 3. Explicar categorias vs tags dentro del flujo

Pain point:

La tester dudo entre crear categorias como `PJs`, `Monstruos`, `Packs`, `Miniaturas`, o usar tags como `elfos`, `silvanos`, etc.

Cambio propuesto:

- Añadir copy corto cuando se elige categoria o cuando se piden tags:
  - "Usa categorias para ubicacion general."
  - "Usa tags para detalles que cruzan categorias: monstruos, elfos, mammoth, pack, etc."
- Evitar convertirlo en tutorial largo. Debe aparecer donde resuelve la duda.

Archivos relevantes:

- `src/telegram/i18n-storage.ts`
  - `askUploadCategory`, `askTags`, `askAddTags`, `askEditTags`.
- `src/telegram/storage-flow.ts`
  - Mensajes de seleccion de categoria en subida.
  - Rama `upload-tags`.
  - `formatUploadPreview(...)`, si se añade aviso cuando no hay tags.
- `src/telegram/storage-flow.test.ts`
  - Ajustar asserts de texto si cambian prompts.

### 4. Preguntar activamente por tags antes de completar

Pain point:

La tester esperaba que el bot preguntase por tags. El flujo actual deja tags como accion opcional en preview y el usuario puede completar sin ver el boton.

Cambio propuesto:

- Despues de elegir categoria y adjuntos, antes de la vista previa final, insertar un paso claro:
  - "Quieres añadir tags?"
  - Opciones: `Añadir tags`, `Omitir`, posiblemente `Completar sin tags`.
- Alternativa menos intrusiva: si el usuario pulsa completar sin tags, mostrar confirmacion:
  - "Sin tags sera mas dificil encontrarlo luego. Completar igualmente?"
- Mantener la posibilidad de omitir, porque no todos los archivos necesitan tags.

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - `advanceUploadPreview(...)`: actualmente inicializa `tags: []` y salta a `upload-preview`.
  - `handleActiveUploadFlow(...)`, ramas `upload-preview`, `upload-tags`.
  - `formatUploadPreview(...)`: muestra `Sin tags`.
- `src/telegram/i18n-storage.ts`
  - `askTags`, `skipOptional`, `entryNoTags`, `uploadAccept`.
  - Nuevos textos: pregunta de tags, completar sin tags, aviso de busqueda.
- `src/telegram/storage-flow.test.ts`
  - `handleTelegramStorageText collects a DM upload...`
  - `handleTelegramStorageText uses the normalized file name as the default upload description`.
  - Tests de subida separada si comparten `advanceUploadPreview`.

Decision pendiente:

- Elegir entre "paso obligatorio pero omitible" o "aviso solo al completar sin tags".

### 5. Aceptar tags sin `#`

Pain point:

La tester descubrio que habia que poner `#`. Propuso palabras separadas por comas. El formato tecnicamente correcto no deberia ser requisito de UX.

Cambio propuesto:

- Aceptar estos formatos como equivalentes:
  - `#mammoth #elfos`
  - `mammoth elfos`
  - `mammoth, elfos, silvanos`
  - `mammoth; elfos`
- Normalizar internamente a slugs de tag estables.
- Mantener soporte para captions existentes con `#tag`.
- Actualizar prompts para decir que no hace falta poner `#`.

Archivos relevantes:

- `src/storage/storage-catalog.ts`
  - `parseStorageCaptionMetadata(...)`: hoy se usa para extraer tags desde texto/caption.
- `src/telegram/storage-flow.ts`
  - Rama `upload-tags`: usa `parseStorageCaptionMetadata(text).tags`.
  - Rama `edit-entry-tags`: usa `parseStorageCaptionMetadata(text).tags`.
  - Rama `add-entry-tags`: usa `parseStorageCaptionMetadata(text).tags`.
  - `collectDraftStorageTags(...)`: extrae tags de captions.
- `src/telegram/i18n-storage.ts`
  - `askTags`, `askAddTags`, `askEditTags`.
- `src/storage/storage-catalog.test.ts`
  - Añadir tests de parser para espacios, comas, `#`, duplicados y normalizacion.
- `src/telegram/storage-flow.test.ts`
  - Añadir prueba de subida con `rol, pdf` o `rol pdf`.
  - Añadir prueba de edicion/add tags sin `#`.

Riesgo:

- Si el parser acepta cualquier palabra de una descripcion larga como tag, podria crear basura. Conviene aplicar el parser flexible solo en prompts que piden tags, no en captions libres, o introducir una funcion especifica como `parseStorageTagInput(...)`.

### 6. Rediseñar la entrada de busqueda

Pain point:

La tester no entendio que podia escribir cualquier cosa. El bot muestra categorias y dice que escribas texto, pero visualmente parece un flujo de navegacion por categorias.

Cambio propuesto:

- Al pulsar `Buscar archivos`, mostrar primero una pantalla simple con dos opciones:
  - `Buscar por palabra o tag`
  - `Explorar categorias`
- En `Buscar por palabra o tag`, pedir texto con ejemplos:
  - "Escribe una palabra, parte del nombre, categoria o tag. Ejemplos: mammoth, elfos, #rol."
- En `Explorar categorias`, usar navegacion nivel a nivel, no lista global plana.

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - Rama `if (text === texts.searchFiles)`: hoy arranca `storage-search` con `stepKey: 'search-scope'` y muestra categorias.
  - `handleActiveSearchFlow(...)`: hoy `search-scope` ejecuta busqueda directa con cualquier texto.
  - `selectStorageSearchCategory(...)`: limita busqueda a categoria elegida.
  - `runStorageSearch(...)`: ejecuta busqueda.
  - `formatStorageSearchResultsMessage(...)`: resultado.
- `src/telegram/i18n-storage.ts`
  - `searchFiles`, `askSearchQuery`, `askSearchScope`, `askSearchQueryInCategory`, `noSearchResults`.
  - Nuevos textos para modo de busqueda y exploracion.
- `src/telegram/storage-flow.test.ts`
  - `handleTelegramStorageText searches entries inside readable categories`.
  - Añadir test para seleccionar modo "buscar por palabra/tag".
  - Añadir test para "explorar categorias" nivel a nivel.

Decision pendiente:

- Si conservar compatibilidad con el comportamiento actual de escribir directamente tras pulsar `Buscar archivos`. Recomendacion: si el usuario escribe texto en la primera pantalla, buscar igualmente; si pulsa `Explorar categorias`, navegar.

### 7. Evitar listas largas de categorias en busqueda

Pain point:

La tester dijo que "esto es larguisimo" y anticipó que con 200 categorias seria peor.

Cambio propuesto:

- No mostrar todas las categorias en la pantalla inicial de busqueda.
- Reusar patron nivel a nivel ya validado en Storage:
  - categorias raiz primero,
  - entrar en subcategorias,
  - boton contextual para seleccionar alcance actual,
  - volver/cancelar.
- Mantener el limite de emergencia `storageCategoryListPageSize`, pero no depender de el como UX principal.

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - `storageCategoryListPageSize`.
  - `formatStorageCategoryListMessage(...)`: actualmente corta a 50 y añade footer.
  - `formatMoveEntryCategoryPrompt(...)`: puede servir de base para navegacion nivel a nivel.
  - `showStorageEntryMoveCategoryNode(...)` y flujo de movimiento: referencia de selector nivel a nivel.
  - `showForwardedStorageCategoryNode(...)`: referencia si reusa selector en importacion reenviada.
- `src/telegram/i18n-storage.ts`
  - `listLimitedCategoriesFooter`.
  - Nuevos textos para explorar categorias desde busqueda.
- `src/telegram/storage-flow.test.ts`
  - Tests existentes de move category y forwarded import con selector nivel a nivel.
  - Test especifico para que busqueda no pinte `storage_select_category_*` de todos los descendientes en la primera pantalla.

### 8. Hacer mas descubribres los tags en busqueda

Pain point:

La tester no sabia como buscar por tags y asumio que Telegram deberia encontrar el contenido directamente. Hubo que explicar que los mensajes reales viven en otro sitio y que hay que buscar via bot.

Cambio propuesto:

- En pantalla de busqueda, mencionar explicitamente:
  - "Telegram no siempre puede buscar dentro del Storage archivado; usa esta busqueda del bot."
  - "Puedes escribir tags con o sin #."
- Mostrar enlace a `Listar tags` o tags populares/recientes si existen.
- Si el usuario busca `#tag`, normalizar igual que `tag`.

Archivos relevantes:

- `src/telegram/storage-flow.ts`
  - `sendStorageTagList(...)`.
  - `sendStorageTagResults(...)`.
  - `buildReadableStorageTagCounts(...)`.
  - `runStorageSearch(...)`.
- `src/telegram/i18n-storage.ts`
  - `tagsHeader`, `noTags`, `tagResultsHeader`, `askSearchQuery`.
- `src/telegram/storage-flow.test.ts`
  - `handleTelegramStorageText lists tags and opens tag results from deep links`.
  - `handleTelegramStorageText searches entries inside readable categories`.

### 9. Revisar taxonomia inicial de categorias

Pain point:

La tester dudo entre `rol`, `libros de rol`, `STL`, `miniaturas`, `packs`, `PJs`, `monstruos`. Esto no es solo UI: afecta como sera usable el Storage en el futuro.

Cambio propuesto:

- Definir una guia corta de taxonomia:
  - categorias = ubicacion principal y tipo de contenido;
  - tags = rasgos cruzados, facciones, criaturas, formatos, campañas;
  - evitar niveles demasiado especificos si el contenido son packs mixtos.
- Si hay seed manual o categorias ya creadas, revisar nombres visibles para que sean evidentes.

Archivos relevantes:

- No parece haber seed obvio en `src/telegram/storage-flow.ts`; las categorias se crean desde runtime.
- `docs/feature-status.md`
  - Si se documenta el criterio de categorias/tags como feature visible, actualizar la seccion `Storage y archivos`.
- `docs/superpowers/specs/2026-04-21-telegram-storage-design.md`
  - Documento historico de diseño, revisar si se quiere preservar criterio.

Decision pendiente:

- Esto puede ser tarea operativa/manual, no necesariamente cambio de codigo.

## Priorizacion recomendada

Primera tanda recomendada:

1. Inline buttons y copy claro en la vista previa de subida.
2. Prompt claro para seleccionar categoria actual.
3. Paso activo de tags u aviso antes de completar sin tags.
4. Parser flexible de tags sin `#`.
5. Rediseño de busqueda separando buscar vs explorar.

Segunda tanda:

6. Navegacion nivel a nivel para explorar categorias desde busqueda.
7. Tags populares/recientes en busqueda.
8. Guia/taxonomia de categorias vs tags.

## Criterios de aceptacion

- En Telegram Web, el usuario puede completar una subida sin abrir manualmente el teclado persistente.
- La vista previa muestra acciones visibles en el propio mensaje.
- El usuario entiende que puede guardar en la categoria actual o entrar en subcategorias.
- El flujo pregunta por tags o avisa claramente antes de completar sin tags.
- `rol pdf`, `rol, pdf` y `#rol #pdf` producen los mismos tags normalizados.
- La busqueda explica que acepta texto, categoria o tag.
- La pantalla inicial de busqueda no lista una taxonomia completa cuando hay muchas categorias.
- Buscar `rol`, `#rol` o una palabra del nombre encuentra entradas esperadas.
- Los tests de Storage cubren subida, tags flexibles y busqueda.
- Si cambia comportamiento visible, `docs/feature-status.md` queda actualizado.
- Antes de cerrar el goal, ejecutar:
  - `npm run typecheck`
  - `node --import tsx --test src/storage/storage-catalog.test.ts src/telegram/storage-flow.test.ts`
  - `./scripts/feature-status-audit.sh`
  - `./startup.sh`

## Archivos principales

- `src/telegram/storage-flow.ts`: flujo principal de Storage, subida, preview, seleccion de categorias, busqueda, tags y callbacks.
- `src/telegram/i18n-storage.ts`: textos de Storage en ca/es/en.
- `src/telegram/storage-flow.test.ts`: cobertura del flujo Telegram de Storage.
- `src/storage/storage-catalog.ts`: parser de metadata/tags y operaciones de catalogo Storage.
- `src/storage/storage-catalog.test.ts`: cobertura de parser y modelo Storage.
- `docs/feature-status.md`: inventario canonico si se modifica comportamiento visible.

## Notas de implementacion

- Evitar que el parser flexible de tags convierta una descripcion completa en tags por accidente. Si hace falta, crear una funcion separada para input explicito de tags y dejar `parseStorageCaptionMetadata(...)` para captions con `#`.
- Preservar enlaces HTML normales en mensajes de categoria/tag; no reemplazar navegacion por botones si el texto ya es clicable.
- Los botones inline propuestos para preview son acciones, no navegacion redundante.
- Mantener `/cancel` como salida visible en todos los subflujos.
- Verificar con mensajes nuevos del bot; mensajes antiguos de Telegram pueden conservar payloads o teclados obsoletos.
