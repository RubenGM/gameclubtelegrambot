# Interacción LLM en lenguaje natural

Este documento describe el funcionamiento actual del asistente LLM de lenguaje
natural del bot. La especificación de producto original sigue en
`llm-command-spec.md`, pero este archivo es la guía operativa que debe mantenerse
actualizada cuando cambie la implementación.

## Objetivo

La feature permite que un socio escriba peticiones naturales como:

- "¿Qué actividades hay esta semana?"
- "¿Qué juegos de mesa tenemos sobre El Señor de los Anillos?"
- "Recomiéndame un juego para 4 personas que esté disponible."
- "¿Qué STL tenemos de Mutant Chronicles?"
- "Es muy complicado este juego?" respondiendo a una ficha del bot.

La LLM no ejecuta lógica de negocio. Sólo interpreta intención, extrae
parámetros, propone mensajes y devuelve JSON. El bot valida ese JSON, aplica
permisos, consulta repositorios internos y decide si ejecuta una lectura, pide
confirmación o deriva al flujo normal.

## Entradas de usuario

La feature se activa por estas vías:

- Comando privado `/ask <mensaje>`.
- Botón privado `Preguntar al bot`, que abre una sesión de conversación.
- Fallback privado configurable para mensajes que no hayan sido manejados por
  otros flujos.
- Menciones al bot en grupos o topics, únicamente cuando `@username` aparece al
  principio del mensaje, después de espacios iniciales.
- Replies a mensajes del bot en grupos o privado.

En grupos y topics sólo se responden lecturas cuando hay una mención explícita al
principio del mensaje o el usuario responde realmente a un mensaje suyo. Las
quotes, las menciones escritas dentro de una frase y los mensajes informativos
como `para usar el bot tenéis que escribir a @cawa_bot` se ignoran. Las escrituras pedidas desde grupo
no se ejecutan allí: el bot debe pedir al usuario que repita o continúe en
privado.

## Seguridad y permisos

Las reglas de seguridad son locales al bot:

- La LLM no tiene acceso directo a base de datos, SQL, shell, tokens ni hashes.
- La LLM no puede inventar intents fuera de la allowlist de
  `src/telegram/llm-command-actions.ts`.
- Los permisos se comprueban en el bot aunque la LLM diga que algo está
  permitido.
- Las lecturas usan umbral local de confianza `readConfidenceThreshold`.
- Las escrituras usan umbral local de confianza `writeConfidenceThreshold` y
  siempre requieren confirmación.
- Las acciones administrativas quedan fuera del asistente general `/ask`. Si se
  detecta una acción admin allí, el usuario debe usar el menú normal de admin o
  el comando específico `/adminai`.
- Las métricas no guardan texto literal del usuario, prompts completos ni
  respuestas completas de la LLM.

### Comando administrativo `/adminai`

`/adminai {petición}` es una entrada separada y exclusiva para administradores.
Está disponible en privado, grupos y topics para poder abrir tanto herramientas
privadas como opciones ligadas al grupo actual. No convierte a Codex en un
ejecutor general:

1. Envía un mensaje editable mientras interpreta la petición con el perfil de
   más pensamiento configurado, actualmente `gpt-5.6-sol` con `low`.
2. Exige una salida estructurada validada por
   `src/telegram/admin-ai-plan.schema.json`.
3. Muestra siempre una explicación en lenguaje natural, la lista numerada de
   acciones previstas y botones inline `Aceptar` y `Cancelar`.
4. Guarda el plan en la sesión `admin-ai`; cancelar elimina la sesión sin
   ejecutar nada y una confirmación caducada no se reutiliza.
5. Al aceptar, vuelve a comprobar que el actor sigue siendo admin, elimina la
   sesión de confirmación y abre el flujo guiado existente o invoca un comando
   local explícitamente permitido.

El campo `target` sólo admite destinos declarados en código: menús de agenda,
mesas, catálogo, préstamos, Storage, compras, LFG, Rol, avisos, usuarios,
bienvenidas, eventos, impresión, modelos IA y preferencias; además de comandos
administrativos concretos como estado, alertas de solicitudes, `/news`,
`/autojoin`, actualización BGG o reinicio. No se aceptan comandos arbitrarios,
argumentos inventados, shell, SQL, HTTP ni escrituras directas en base de datos.
Si la petición es vaga, mezcla flujos independientes o no tiene un destino
seguro exacto, el plan deriva al menú admin o a la ayuda contextual.

Los destinos privados sólo se abren desde el chat privado. `/news` y
`/autojoin` sólo se despachan desde el grupo o topic actual. Tras confirmar, el
handler normal conserva sus comprobaciones y confirmaciones internas. La
confirmación se registra en auditoría con destino, acciones y contexto, pero no
conserva el prompt literal del administrador.

## Proveedor LLM

La integración usa `src/telegram/llm-command-service.ts`.

El proveedor recomendado y operativo es Codex:

```bash
GAMECLUB_LLM_COMMANDS_PROVIDER=codex
GAMECLUB_CODEX_BIN=./scripts/codex-cawa.sh
GAMECLUB_LLM_COMMANDS_MODEL=gpt-5.6-luna
GAMECLUB_LLM_COMMANDS_REASONING_EFFORT=low
```

No se debe invocar `codex` directamente desde el servicio. En despliegue, el bot
corre como `gameclubbot`, pero Codex debe ejecutarse mediante el wrapper
`GAMECLUB_CODEX_BIN` como usuario operador `cawa`, que es donde están las
credenciales.

El despliegue operativo usa exclusivamente Codex mediante `GAMECLUB_CODEX_BIN`.

Las funciones auxiliares del catálogo (lectura de títulos visibles en portadas y
fallback de traducción de descripciones) usan también Codex mediante
`GAMECLUB_CATALOG_CODEX_BIN`, o `GAMECLUB_CODEX_BIN` cuando no se configura el
primero. La invocación usa siempre `codex exec --ephemeral --sandbox read-only`;
para portadas adjunta la imagen con `--image`.

## Configuración

Las variables runtime principales son:

```bash
GAMECLUB_LLM_COMMANDS_ENABLED=false
GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED=true
GAMECLUB_LLM_COMMANDS_PROVIDER=codex
GAMECLUB_CODEX_BIN=./scripts/codex-cawa.sh
GAMECLUB_LLM_COMMANDS_MODEL=gpt-5.6-luna
GAMECLUB_LLM_COMMANDS_REASONING_EFFORT=low
GAMECLUB_LLM_COMMANDS_TIMEOUT_MS=60000
GAMECLUB_LLM_COMMANDS_MAX_HISTORY=8
GAMECLUB_LLM_COMMANDS_SESSION_TTL_MINUTES=15
GAMECLUB_LLM_COMMANDS_MAX_PROMPT_CHARS=12000
GAMECLUB_LLM_COMMANDS_READ_CONFIDENCE_THRESHOLD=0.75
GAMECLUB_LLM_COMMANDS_WRITE_CONFIDENCE_THRESHOLD=0.90
GAMECLUB_LLM_COMMANDS_DRY_RUN=false
```

`GAMECLUB_LLM_COMMANDS_ENABLED` controla la feature completa. El fallback
privado se puede apagar con
`GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED=false` sin desactivar `/ask`,
el botón privado ni las lecturas por mención/reply en grupos.

## Flujo principal

El flujo Telegram vive en `src/telegram/llm-command-flow.ts`.

1. El bot recibe una entrada válida de lenguaje natural.
2. Envía inmediatamente un mensaje editable de progreso.
3. Construye el prompt con `src/telegram/llm-command-prompt.ts`.
4. Invoca el proveedor mediante `src/telegram/llm-command-service.ts`.
5. Valida el JSON con `src/telegram/llm-command-schema.ts` y el schema
   `src/telegram/llm-command-decision.schema.json`.
6. Enruta la decisión con `src/telegram/llm-command-router.ts`.
7. Ejecuta una lectura, pide aclaración, pide confirmación o rechaza la petición.
8. Completa el mismo mensaje editable con el resultado final cuando sea posible.

El mensaje de progreso debe ser breve: barra aproximada, fase y detalle
separados por líneas en blanco. No debe mostrar la petición completa del usuario.
Si la LLM falla o caduca, el mismo mensaje debe editarse con el error final
siempre que Telegram lo permita.

La primera pasada usa Codex con el perfil normal, `gpt-5.6-luna` con `low`.
Cuando esa pasada detecta que la siguiente fase necesitará interpretación
semántica sobre datos reales, puede pedir escalado con `nextStep`. El bot valida
esa petición localmente y, sólo para intents de lectura permitidos, ejecuta la
siguiente llamada `generateJson` con el perfil reforzado Sol/`low`.

Los perfiles operativos fijados son Luna/`low` para interpretar la petición y
Sol/`low` para las lecturas semánticas escaladas. Los admins pueden cambiar
estos dos perfiles desde Telegram, en el submenú
`Admin` -> `Modelos IA`:

- Perfil normal: usado para la primera interpretación de la petición.
- Perfil de más pensamiento: usado cuando `nextStep.useStrongerModel=true` y el
  intent está en la allowlist de escalado.

La selección se guarda en `app_metadata` con clave `llm.model_settings`, tiene
efecto inmediato y no requiere reiniciar el servicio. Si no hay selección
guardada o no se puede cargar, el fallback sigue siendo `gpt-5.6-luna` con
`low` para normal y `gpt-5.6-sol` con `low` para más pensamiento.

Modelos seleccionables:

- `GPT-5.6-Luna`: `low`.
- `GPT-5.6-Sol`: `low`.

- `GPT-5.3-Codex-Spark`: `none`, `low`, `medium`, `high`, `xhigh`.
- `GPT-5.4-Mini`: `none`, `low`, `medium`.
- `GPT-5.4`: `none`, `low`, `medium`.
- `GPT-5.5`: `none`, `low`, `medium`.

El mismo menú permite lanzar un test pequeño para una combinación de
modelo/reasoning. El test comprueba una interpretación estructurada de Storage,
mide duración y guarda el resultado en `data/llm-model-tests/<modelo>_<reasoning>.json`,
sobrescribiendo el resultado anterior de esa misma combinación. Tokens y coste
se guardan como `null` cuando Codex no los expone de forma fiable.

## Contrato JSON de interpretación

La primera pasada LLM debe devolver un objeto `LlmCommandDecision`:

- `version`: versión del contrato.
- `language`: idioma detectado.
- `intent`: intent permitido.
- `confidence`: confianza entre 0 y 1.
- `reply`: texto que el bot puede usar si procede.
- `progress.messages`: hasta 4 mensajes cortos para personalizar el progreso.
- `nextStep.useStrongerModel`: petición no autoritativa para que la siguiente
  pasada use un modelo más fuerte.
- `nextStep.reason`: motivo breve cuando se pide escalado, o `null`.
- `needsClarification` y `clarification`: pregunta y campos esperados.
- `requiresConfirmation` y `confirmation`: texto y parámetros para escritura.
- `action`: tipo, nombre y parámetros.
- `safety`: señales de riesgo propuestas por la LLM.

El bot no confía ciegamente en `safety`. El riesgo real se deriva de la
capacidad local declarada en `llm-command-actions.ts`.

El bot tampoco confía ciegamente en `nextStep`. Aunque la LLM pida modelo fuerte,
el escalado sólo se aplica a lecturas semánticas allowlisted:

- `bot.search`
- `catalog.detail`
- `catalog.recommend`
- `storage.search`

No se usa para permisos, admin, escrituras ni para abrir capacidades nuevas.

## Capacidades

El catálogo de capacidades está en `src/telegram/llm-command-actions.ts`.

Lecturas principales:

- `help.capabilities`
- `general.answer`
- `bot.search`
- `schedule.today`, `schedule.upcoming`, `schedule.search`
- `catalog.search`, `catalog.detail`, `catalog.recommend`
- `catalog.loan.list`
- `storage.search`, `storage.category.list`, `storage.entry.detail`
- `notice.list`
- `group_purchase.list`, `group_purchase.detail`
- `lfg.list`
- `news.status`

Escrituras preparadas o delegadas a flujos normales:

- `schedule.create`, `schedule.join`, `schedule.leave`
- `catalog.loan.create`
- `storage.upload.start`, `storage.entry.edit`
- `notice.create`, `notice.archive`
- `group_purchase.join`, `group_purchase.create`
- `lfg.create`

Acciones admin como `catalog.create` o `catalog.edit` están declaradas para que
el asistente general pueda reconocerlas, pero `/ask` debe rechazarlas y
derivarlas al menú normal. `/adminai` usa un contrato y una allowlist separados;
no amplía la autoridad del contrato general.

## Feedback loop de lectura

Algunas lecturas no terminan con un render determinista. En esos casos el bot
hace una segunda pasada LLM:

1. El bot consulta datos reales en repositorios internos.
2. Prepara una lista estructurada con campos relevantes.
3. Envía esos datos, el mensaje del usuario y el contexto de reply a la LLM.
4. La LLM devuelve JSON con una respuesta breve en texto plano.
5. El bot escapa el texto, añade enlaces generados por código y edita el mensaje
   final.

La segunda pasada usa `src/telegram/llm-read-answer.schema.json`. Si falla, el
bot debe usar un fallback determinista con enlaces.

Si la primera pasada pidió escalado y el intent está permitido, esta segunda
pasada usa el perfil de más pensamiento configurado por admin; si no, usa el
modelo base configurado para la feature.

Ejemplos donde se usa o se puede usar esta segunda pasada:

- `catalog.detail`: responder preguntas sobre dificultad, duración, jugadores o
  datos BGG de un juego concreto.
- `catalog.recommend`: elegir entre candidatos reales filtrados por jugadores,
  disponibilidad y metadatos.
- `storage.search`: separar material de rol, PDFs, aventuras o mapas de modelos
  STL cuando comparten franquicia.
- `bot.search`: redactar una respuesta transversal usando agenda, catálogo,
  Storage, compras conjuntas, avisos y LFG.

## Recomendaciones de catálogo

`catalog.recommend` no debe usar el texto de consulta como filtro duro. El bot:

- Filtra por tipo de ítem, disponibilidad y número de jugadores cuando proceda.
- Usa la consulta como ranking semántico sobre texto y metadatos BGG.
- Interpreta juegos mencionados como referencia si hay alternativas.
- Prioriza solapamiento de mecánicas y categorías BGG.
- Expande términos frecuentes, por ejemplo `deck builder` hacia mecánicas tipo
  deck/bag/pool building.
- Aplica fallback a rangos de jugadores cercanos, juegos prestados o metadatos
  incompletos cuando no hay coincidencia exacta.
- Envía candidatos reales a la LLM para que elija uno o varios.
- Renderiza nombres con enlaces al detalle del bot.

## Storage y contenido de rol

Storage puede contener STL de impresión 3D, PDFs, libros de rol, aventuras,
fichas, mapas u otros archivos. Cuando el usuario pide material de rol, libros o
contenido narrativo, el bot debe entregar a la LLM datos suficientes para
distinguir el tipo de contenido: descripción, categoría, tags, nombres de
archivos, tipo de adjunto y metadatos disponibles.

Las búsquedas normales de Storage sólo exponen categorías de propósito
`user_uploads`. Las categorías internas como `catalog_media` y los handouts de
Rol (`role_game_handouts`) no se entregan a `storage.search`, `bot.search`,
listados de categorías ni enlaces `storage_entry_<id>`. Los materiales de Rol
deben abrirse por enlaces `role_material_<id>` y por los permisos propios de
Rol cuando esa entrega esté conectada.

La categoría principal de STL representa el ámbito completo de contenido de
impresión 3D. Todo lo que cuelga de esa raíz debe interpretarse como STL,
modelos 3D, figuras, estatuas, miniaturas, dioramas o términos equivalentes,
aunque la entrada o el archivo concreto no repita esas palabras.

Cuando la búsqueda textual coincide con una categoría de Storage, el bot añade
también los archivos de esa categoría y de sus descendientes. Esto permite
resolver consultas por franquicia o carpeta, por ejemplo `Attack on Titan`, aun
cuando los archivos reales estén en una subcategoría como `Mikasa & Levi
Diorama` y no repitan el nombre de la franquicia en el archivo. La segunda
pasada LLM recibe la ruta completa de categoría para cada candidato.

En consultas de impresión 3D, `STL` se trata como tipo de contenido, no como
extensión literal obligatoria. Muchos modelos se suben comprimidos como `.zip` o
`.rar`, así que el bot ignora `stl` en `fileExtensions` y deja que la categoría,
descripción, tags, nombres de archivo y refinado semántico determinen si encaja.

La LLM puede ayudar a filtrar semánticamente, pero no debe inventar contenido ni
ocultar que los datos reales son ambiguos.

## Replies como contexto conversacional

Si un usuario responde a un mensaje del bot, `runtime-boundary-support.ts`
extrae el texto o caption del mensaje respondido y lo añade como contexto.

Usos esperados:

- Preguntar por una ficha concreta de catálogo.
- Pedir aclaraciones sobre una lista de resultados.
- Continuar una búsqueda sin repetir el objeto principal.

Para catálogo, si la LLM omite `query` en `catalog.detail`, el bot intenta
inferir el título desde la ficha respondida antes de consultar.

## Enlaces y resultados largos

Cuando la respuesta mencione contenido del bot, debe incluir enlaces útiles
generados por código:

- Catálogo: `catalog_read_item_<id>`.
- Storage: `storage_entry_<id>` y enlaces a categoría o raíz cuando haya más
  resultados.
- Agenda: `schedule_event_<id>` o `schedule_details_<id>`.
- Compras conjuntas: `group_purchase_<id>`.

Las listas directas pueden mostrar más resultados que las secciones agrupadas.
Si hay más resultados que los mostrados, el texto debe enlazar una vista donde
el usuario pueda continuar, no pedirle que "abra el privado" sin destino.

## Sesiones y fallback

La sesión LLM usa el flow key `llm-command` y conserva historial corto para
seguir conversaciones. Las sesiones expiran según
`GAMECLUB_LLM_COMMANDS_SESSION_TTL_MINUTES`.

El fallback privado no debe capturar comandos, callbacks, deep links ni flujos
activos. Las sesiones pasivas de lectura de catálogo son una excepción: si el
texto libre no corresponde a una acción del detalle, puede continuar hacia la
LLM para permitir preguntas sobre la ficha.

Antes del fallback LLM, el bot puede ofrecer recoger feedback ante una señal de
frustración o insulto detectada localmente. Esta detección sólo funciona en
privado para socios aprobados y no bloqueados, usa diccionarios y frases fijas
en catalán, español e inglés, no invoca ningún modelo y no captura
flujos activos; al aceptar, el usuario escribe el feedback que se guarda en el
mismo fichero que el formulario web.

## Observabilidad y fallos

Las métricas se registran con intención, confianza, origen, tipo de chat,
resultado, duración y motivo saneado. Para depurar runtime usa:

```bash
./scripts/service-journal.sh -n 200
```

Errores esperados:

- `timeout`: el proveedor superó `GAMECLUB_LLM_COMMANDS_TIMEOUT_MS`.
- `invalid_json`: la salida no cumple el contrato.
- `not_configured`: falta wrapper o configuración.
- `process_failed`: el proceso externo falló.

Los timeouts deben comunicarse con texto específico. Los fallos de edición del
mensaje de progreso se registran como warning estructurado, pero no deben romper
la acción. El error de Telegram `message is not modified` debe tratarse como
no-op correcto y no debe desactivar futuras ediciones.

## Archivos relevantes

- `llm-command-spec.md`: especificación de producto y backlog original.
- `docs/llm-natural-language.md`: documentación operativa actual.
- `src/telegram/llm-command-flow.ts`: entrada Telegram, progreso, sesiones y
  cierre de respuestas.
- `src/telegram/llm-command-prompt.ts`: prompt de interpretación.
- `src/telegram/llm-command-service.ts`: ejecución Codex/OpenCode.
- `src/telegram/llm-command-schema.ts`: validación Zod del contrato.
- `src/telegram/llm-command-decision.schema.json`: schema usado por Codex para
  la primera pasada.
- `src/telegram/llm-read-answer.schema.json`: schema usado para síntesis de
  respuestas de lectura.
- `src/telegram/llm-command-router.ts`: decisión local de ejecutar, confirmar,
  aclarar o rechazar.
- `src/telegram/llm-command-actions.ts`: allowlist de capacidades.
- `src/telegram/llm-command-read-actions.ts`: lecturas, búsquedas, refinados,
  recomendaciones y respuestas con enlaces.
- `src/telegram/admin-ai-flow.ts`: planificación admin, sesión de confirmación y
  callbacks aceptar/cancelar.
- `src/telegram/admin-ai-plan.schema.json`: destinos administrativos permitidos
  y contrato de explicación/acciones.
- `src/telegram/runtime-boundary-support.ts`: extracción de menciones, replies,
  topics y contexto Telegram.
- `src/telegram/editable-progress.ts`: helper de mensajes editables.
- `docs/telegram-editable-progress.md`: guía general de progreso editable.
- `docs/feature-status.md`: inventario operativo que debe reflejar cambios
  visibles o técnicos.

## Mantenimiento obligatorio

Cuando cambie la interacción LLM o el chat de lenguaje natural, actualiza este
documento en el mismo cambio. En particular, actualízalo si cambian:

- Entradas de activación.
- Capacidades, intents o riesgos.
- Reglas de permisos, grupo/privado o acciones admin.
- Contratos JSON o schemas.
- Política de escalado `nextStep` y modelos/reasoning usados en segunda pasada.
- Prompts relevantes.
- Feedback loop o datos enviados a la LLM.
- Enlaces generados en respuestas.
- Configuración runtime.
- Timeouts, errores o mensajes de progreso.
- Métricas y privacidad.

Si el cambio altera comportamiento visible o capacidad operativa, actualiza
también `docs/feature-status.md`.

## Validación recomendada

Para cambios en esta feature ejecuta como mínimo:

```bash
node --import tsx --test src/telegram/llm-command-schema.test.ts src/telegram/llm-command-prompt.test.ts src/telegram/llm-command-flow.test.ts src/telegram/llm-command-router.test.ts src/telegram/llm-command-service.test.ts src/telegram/llm-command-read-actions.test.ts src/telegram/editable-progress.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```

Si el cambio toca configuración runtime, instalador o despliegue, revisa también
el journal del servicio tras `./startup.sh`.
