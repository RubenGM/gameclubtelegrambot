# BGG Collection Selection And Error Reporting Design

## Goal

Mejorar la importacion de colecciones de BoardGameGeek desde Telegram para que el usuario reciba errores utiles y pueda elegir que coleccion importar en lugar de depender siempre de una importacion directa por `username`.

La UX objetivo es:

- pedir primero el `username` de BoardGameGeek
- intentar descubrir las colecciones o listas importables asociadas a ese usuario
- mostrar una lista seleccionable cuando BGG permita detectarlas
- ofrecer un fallback para escribir manualmente el nombre de la coleccion cuando no se puedan listar todas de forma fiable
- devolver mensajes de error con contexto suficiente para entender si ha fallado la configuracion, el listado o la importacion

## Scope

La v1 cubre solo:

- el flujo Telegram de `Importar coleccion BGG` en `src/telegram/catalog-admin-support.ts`
- los textos i18n de catalogo admin en `src/telegram/i18n-catalog-admin.ts`
- el servicio de importacion BGG en `src/catalog/wikipedia-boardgame-import-service.ts`
- la separacion entre descubrimiento de colecciones y carga de items concretos
- la mejora de mensajes de error y sugerencias de siguiente paso

La v1 no cubre:

- cambios en la reconciliacion posterior del catalogo ya importado
- cambiar la fuente principal fuera de BoardGameGeek
- incorporar Wikipedia en este flujo de colecciones salvo fallback extremo ya existente fuera de este alcance
- soportar cualquier dato privado o no expuesto por la API publica de BGG
- ejecutar o anadir tests del proyecto durante esta tarea de migracion BGG

## Current Project Context

Hoy el flujo de Telegram solo hace esto:

1. pide un `username`
2. llama directamente a la importacion por usuario
3. intenta cargar la coleccion de propiedad con juegos y expansiones
4. si algo falla, devuelve un mensaje generico seguido del error en texto libre

El servicio actual mezcla en una sola operacion varias responsabilidades:

- resolver la coleccion del usuario
- pedir los items a BGG
- cargar los detalles `thing`
- convertir errores HTTP en un mensaje generico como `BoardGameGeek lookup failed with status 400`

Eso deja dos problemas claros:

- el usuario no sabe en que paso ha fallado la operacion ni que hacer despues
- el flujo no contempla elegir colecciones detectables ni pedir manualmente una coleccion concreta cuando BGG no la expone bien

La arquitectura actual ya tiene un buen punto de apoyo:

- `catalog-admin-support.ts` orquesta sesiones y respuestas Telegram
- `i18n-catalog-admin.ts` concentra el texto visible
- `wikipedia-boardgame-import-service.ts` ya encapsula las llamadas a BGG

La mejora debe mantener ese reparto y concentrar la nueva logica BGG dentro del servicio, dejando a Telegram principalmente la orquestacion de pasos y mensajes.

## Recommended Architecture

La solucion recomendada separa descubrimiento e importacion, introduce un paso explicito de seleccion de coleccion y convierte los errores BGG en respuestas estructuradas y accionables.

### 1. Split Service Responsibilities

El servicio BGG debe dejar de exponer solo `importByUsername(username)` como entrada unica.

Debe separar al menos dos operaciones:

- descubrimiento de colecciones o listas importables para un `username`
- importacion de una coleccion concreta seleccionada por una clave detectada o por un nombre escrito manualmente

El objetivo no es modelar toda la semantica interna de BGG, sino dar una interfaz suficiente para que Telegram pueda:

- listar opciones legibles
- decidir si puede mostrar botones
- saber cuando debe ofrecer el fallback manual

### 2. Structured Import Errors

Los errores del servicio deben dejar de ser solo texto libre y pasar a incluir contexto estructurado.

Campos minimos recomendados:

- `type`: categoria general del error
- `stage`: `list-collections` | `import-collection` | `load-things`
- `httpStatus`: entero opcional cuando exista respuesta HTTP
- `message`: texto legible y corto
- `canRetryManually`: boolean para saber si tiene sentido ofrecer escritura manual
- `username`: opcional, para componer mensajes mas utiles en Telegram

Esto permite que Telegram renderice mensajes mas precisos sin inspeccionar strings fragiles.

### 3. Collection Discovery Model

La operacion de descubrimiento debe devolver una lista de opciones detectables con etiquetas legibles para el usuario.

Cada opcion debe incluir como minimo:

- una `key` o valor estable para reutilizarla en el paso siguiente
- una `label` visible en Telegram
- suficiente informacion interna para saber como volver a consultar la API al importar

La lista debe intentar incluir todo lo que BGG permita detectar de forma fiable:

- listas o colecciones estandar visibles mediante la API
- cualquier otra variante detectable sin scraping ni heuristicas fragiles

Si la API no permite listar de forma fiable todas las opciones personalizadas, el servicio debe indicarlo para que Telegram anada una opcion explicita de entrada manual.

### 4. Telegram Session Flow

El flujo `Importar coleccion BGG` pasa de un paso unico a esta secuencia:

1. `bgg-username`
2. `bgg-collection-choice`
3. `bgg-collection-manual-name` solo cuando el usuario elija fallback manual o cuando el listado no sea fiable
4. importacion y reconciliacion existente

Comportamiento esperado:

- tras recibir `username`, el bot responde con un mensaje de carga de colecciones
- si hay opciones detectadas, muestra un teclado con esas colecciones y una opcion `Escribir nombre de coleccion` cuando el fallback manual sea aplicable
- si no hay opciones detectadas pero el fallo permite intentar manualmente, el flujo no se cancela: pasa a pedir el nombre
- si el problema es de configuracion o autenticacion del bot, el flujo se cancela con un mensaje claro

### 5. Minimal Change To Catalog Reconciliation

La reconciliacion actual de items importados puede mantenerse sin cambios funcionales.

La mejora se concentra en el tramo anterior:

- detectar que coleccion importar
- llamar al servicio correcto con la eleccion del usuario
- explicar mejor por que falla cada paso

No hace falta redisenar el create or update del catalogo para resolver este problema.

## Data Flow

### Flow 1: Detectable collections

1. El administrador pulsa `Importar coleccion BGG`.
2. El bot pide el `username`.
3. El administrador escribe el usuario.
4. El bot consulta a BGG las colecciones o listas detectables.
5. El bot muestra un teclado con las opciones detectadas y `Escribir nombre de coleccion` si procede.
6. El administrador elige una opcion detectada.
7. El bot importa esa coleccion.
8. El sistema reutiliza la reconciliacion actual y muestra el resumen final.

### Flow 2: Detectable listing unavailable but manual fallback allowed

1. El administrador escribe el `username`.
2. El listado de colecciones falla o resulta insuficiente para mostrar opciones fiables.
3. El servicio marca `canRetryManually = true`.
4. El bot explica que no ha podido listar las colecciones para ese usuario y pide escribir el nombre exacto.
5. El administrador escribe el nombre de la coleccion.
6. El bot intenta importar esa coleccion concreta.
7. Si funciona, continua con la reconciliacion actual y el resumen.

### Flow 3: Configuration or auth failure

1. El administrador escribe el `username`.
2. BGG responde `401` o el bot no tiene configurada la API key.
3. El servicio devuelve un error estructurado de autenticacion o configuracion.
4. El bot cancela el flujo y responde con un mensaje claro de configuracion, sin ofrecer elegir coleccion ni escribir un nombre a ciegas.

## Error Handling

Los mensajes de error deben explicar el paso fallido y sugerir una accion cuando exista una salida clara.

Reglas concretas:

- `400` durante `list-collections`:
  - indicar que ha fallado el listado de colecciones para ese `username`
  - incluir `HTTP 400`
  - si el servicio considera viable el fallback manual, ofrecer escribir el nombre de la coleccion
- `401` en cualquier paso:
  - indicar problema de autorizacion o configuracion de BGG
  - no ofrecer continuar a ciegas
- `404` o respuesta sin colecciones importables:
  - indicar que no se han encontrado colecciones importables para ese usuario
- demasiados `202` seguidos:
  - indicar que BGG no termino de preparar la respuesta a tiempo
  - sugerir reintentar mas tarde
- XML invalido o datos inutiles:
  - indicar que BGG devolvio una respuesta no util para completar el paso
  - ofrecer fallback manual solo si el servicio cree que puede ayudar

Formato objetivo del mensaje visible en Telegram:

- corto al principio
- con contexto suficiente en la segunda frase
- con una accion siguiente cuando exista

Ejemplos objetivo:

- `No he podido listar las colecciones de BoardGameGeek para ruben (HTTP 400). Si el usuario existe pero BGG no deja listarlas, escribe el nombre exacto de la coleccion para probar la importacion manual.`
- `No he podido importar la coleccion de BoardGameGeek para ruben porque la configuracion de autenticacion de BGG no es valida.`
- `BoardGameGeek no ha devuelto ninguna coleccion importable para ruben.`

No se deben exponer:

- XML crudo
- trazas internas
- mensajes excesivamente tecnicos mas alla del codigo HTTP y el paso fallido

## I18n Changes

Los textos de catalog admin deben separar mensajes que hoy estan mezclados.

Nuevas necesidades de texto:

- pedir `username`
- informar de que se estan cargando colecciones
- pedir eleccion de coleccion
- ofrecer `Escribir nombre de coleccion`
- pedir nombre manual de coleccion
- error al listar colecciones
- error al importar coleccion
- error de configuracion o autenticacion BGG
- mensaje cuando no se detectan colecciones importables

La interpolacion debe soportar al menos `username`, `httpStatus` y el texto breve de la accion siguiente cuando aplique.

## Testing

Esta linea de trabajo tiene una restriccion explicitamente acordada: no crear ni ejecutar tests del proyecto durante la tarea BGG.

La validacion objetivo para implementacion futura debe hacerse mediante comprobaciones manuales del flujo:

- usuario con varias colecciones detectables
- usuario sin colecciones detectables pero con fallback manual disponible
- error `400` al listar con mensaje util y opcion manual
- error `401` con cancelacion y mensaje de configuracion
- importacion correcta tras elegir una coleccion detectada
- importacion correcta tras escribir el nombre manual

## Acceptance Criteria

- El flujo deja de depender de una importacion directa por `username` como unica opcion.
- Tras escribir el `username`, el bot intenta descubrir colecciones o listas detectables.
- Si hay opciones detectables, el bot las muestra para elegir desde Telegram.
- Si no se pueden listar todas de forma fiable pero sigue siendo viable importar manualmente, el bot ofrece escribir el nombre de la coleccion.
- Los errores incluyen al menos el paso fallido y el codigo HTTP cuando exista.
- Los errores de configuracion o autenticacion cancelan el flujo con un mensaje claro.
- La reconciliacion posterior del catalogo se mantiene sin redisenarse.
- BoardGameGeek sigue siendo la fuente principal del flujo de colecciones.
