# BoardGameGeek API Skill Design

## Goal

Crear una skill interna para `gameclubtelegrambot` que guie de forma consistente el trabajo futuro sobre la API XML2 de BoardGameGeek cuando se añadan nuevas features al bot.

La skill debe reducir ambiguedad sobre:

- cuando usar BoardGameGeek dentro del repo
- que endpoints consultar primero segun la tarea
- como interpretar respuestas XML2 para catalogo y detalle de juegos
- como decidir entre multiples candidatos sin inventar datos

## Scope

La v1 cubre solo:

- una skill `boardgamegeek-api/` basada solo en `SKILL.md`
- orientacion especifica para este repo y su bot de Telegram
- uso prioritario de los endpoints `search`, `thing`, `collection` y `hot`
- recomendaciones para importacion de catalogo, enriquecimiento de fichas y features basadas en colecciones de usuario
- reglas de desambiguacion y seleccion de candidatos alineadas con el proyecto
- ejemplos de prompts que favorezcan el disparo correcto de la skill

La v1 no cubre:

- scripts auxiliares para hacer requests o parsear XML
- fixtures, evals o benchmarking de la skill
- documentacion exhaustiva de todos los endpoints de XML API2
- fallback a Wikipedia dentro de la skill
- cambios de codigo del bot en esta fase de diseno

## Current Project Context

El proyecto ya adopto BoardGameGeek como fuente principal para metadata de juegos de mesa.

Las decisiones relevantes que la skill debe respetar son:

- el bot ya usa correctamente el token de BGG, asi que la skill no necesita resolver autenticacion como problema central
- para trabajo real con catalogo, BoardGameGeek se usa antes que otras fuentes
- en importacion de juegos, las coincidencias por nombre principal pesan mas que los nombres alternativos
- si la API devuelve varios candidatos razonables, el flujo debe pedir seleccion al usuario en vez de asumir uno automaticamente

Esto implica que la skill no debe escribirse como documentacion generica de la API, sino como una guia operativa para ampliar capacidades del bot sin romper esas reglas.

## Recommended Architecture

La solucion se mantiene deliberadamente pequena y se divide en dos piezas conceptuales.

### 1. Skill Metadata and Triggering

La skill vivira en una carpeta nueva `boardgamegeek-api/` con un `SKILL.md` corto pero suficientemente explicito para dispararse cuando el usuario pida:

- integrar BoardGameGeek en el bot
- importar o enriquecer metadata de juegos de mesa
- consultar detalles de juegos usando BGG XML API2
- construir features basadas en colecciones de usuario de BGG
- comparar o seleccionar candidatos devueltos por BGG

La descripcion del frontmatter debe ser intencionalmente accionable y mencionar tanto BoardGameGeek como BGG XML API2, catalog import, board-game metadata, collection features y Telegram bot work para evitar infradisparo.

### 2. Operational Guidance in `SKILL.md`

El cuerpo de la skill debe organizarse por tarea, no por endpoint puro.

Estructura recomendada:

- `When to use this skill`
- `Project assumptions`
- `Endpoint selection by task`
- `Interpreting XML2 responses`
- `Candidate resolution rules`
- `Safety and failure handling`
- `Prompt examples`

La skill debe explicar el flujo recomendado por caso de uso.

#### Importacion y enriquecimiento de catalogo

- empezar por `search` para obtener candidatos
- seguir con `thing` para cargar detalle confiable de cada candidato viable
- revisar nombre principal, año, jugadores, tiempos, imagenes y links antes de usar datos para el catalogo
- si hay varias coincidencias razonables, no decidir automaticamente

#### Lectura de detalle de un juego

- usar `thing` como fuente principal del detalle estructurado
- mirar especialmente `name`, `description`, `yearpublished`, `minplayers`, `maxplayers`, `playingtime`, `minplaytime`, `maxplaytime`, `image`, `thumbnail`, `link` y estadisticas
- tratar el XML como fuente estructurada pero incompleta; si un dato no esta, la skill debe recomendar omitirlo antes que inferirlo

#### Features basadas en colecciones de usuario

- usar `collection` cuando la feature dependa de la biblioteca publica de un usuario de BGG
- advertir que una coleccion puede no estar disponible, tardar o requerir reintentos
- separar claramente datos de coleccion del detalle canonico del juego, que sigue saliendo de `thing`

#### Descubrimiento o listados populares

- usar `hot` solo para listados o exploracion
- no usar `hot` como fuente suficiente para catalogar un juego sin pasar luego por `thing`

## Data Flow

### Flow 1: Catalog import or update

1. La tarea parte de un nombre de juego o una necesidad de enriquecer metadata.
2. La skill indica consultar `search` para reunir candidatos.
3. La skill indica filtrar coincidencias claras por nombre principal antes que por alias.
4. Para cada candidato viable, la skill indica consultar `thing`.
5. Se comparan los campos relevantes para decidir si hay una sola coincidencia confiable o si hace falta seleccion del usuario.
6. Solo despues de esa validacion se usan los datos para el bot.

### Flow 2: User collection feature

1. La tarea parte de un usuario de BGG o una feature basada en biblioteca personal.
2. La skill indica consultar `collection` para obtener la lista de items.
3. Si hace falta detalle rico de un item concreto, la skill indica pasar por `thing` con el `id` de BGG.
4. La feature del bot usa `collection` para pertenencia y `thing` para metadata canonica.

### Flow 3: Popular discovery feature

1. La tarea pide sugerencias, tendencias o exploracion.
2. La skill indica usar `hot` para obtener una lista inicial.
3. Si algun juego se va a mostrar con detalle o guardar, la skill indica ampliarlo via `thing`.

## Error Handling

- Si `search` devuelve multiples coincidencias razonables, la skill debe instruir a pedir seleccion al usuario.
- Si `thing` no devuelve datos utilizables para el `id` esperado, la skill debe recomendar abortar la importacion o dejar el campo vacio, no inventarlo.
- Si `collection` falla, tarda demasiado o no expone la biblioteca esperada, la skill debe tratarlo como limitacion operacional de BGG y no como evidencia de que el usuario no tiene juegos.
- Si un endpoint devuelve informacion parcial, la skill debe recomendar usar solo los campos presentes y mantener vacios los ausentes.

## Testing

La v1 de la skill no necesita scripts ni tests del proyecto.

La validacion sera manual y documental:

- revisar que la descripcion dispare en tareas reales de BGG dentro del bot
- revisar que los ejemplos cubran importacion, detalle y colecciones
- revisar que la skill no contradiga las decisiones ya tomadas por el repo
- revisar que la skill no presente `hot` o `collection` como sustitutos de `thing` para metadata canonica

## Acceptance Criteria

- Existe una carpeta `boardgamegeek-api/` con un `SKILL.md` nuevo.
- La skill esta escrita para `gameclubtelegrambot`, no como documentacion generica de XML API2.
- La skill cubre claramente `search`, `thing`, `collection` y `hot`.
- La skill deja claro como resolver candidatos multiples y cuando pedir seleccion al usuario.
- La skill no introduce scripts, tests ni dependencias nuevas.
