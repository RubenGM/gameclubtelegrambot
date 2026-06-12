# Especificación: intérprete LLM de órdenes naturales

## Contexto

El bot ya ofrece muchas capacidades útiles, pero el usuario tiene que conocer
comandos, menús y flujos concretos para llegar a ellas. La intención de esta
feature es permitir que una persona escriba una petición natural y que el bot
entienda qué quiere hacer, pida aclaraciones cuando falte información y ejecute
la capacidad estándar correspondiente.

Ejemplos de intención inicial:

- "oye bot, ¿qué actividades hay hoy en el club?"
- "¿tenemos algún juego de mesa de El Señor de los Anillos?"
- "dame una lista de los STL de Dragon Ball que tengamos subidos"

La feature debe crecer hasta cubrir casi cualquier cosa no administrativa que el
bot permita hacer a ese usuario: consultar, crear, editar, publicar, unirse o
archivar recursos, siempre respetando permisos, confirmaciones y los flujos
existentes.

## Objetivo

Crear una capa de interpretación de lenguaje natural que use una LLM para
convertir mensajes de usuario en una decisión estructurada que el bot pueda
validar y ejecutar.

La LLM no debe ejecutar lógica de negocio ni tener autoridad propia. Debe actuar
como router semántico y asistente de recopilación de datos:

1. Identifica la intención.
2. Extrae parámetros.
3. Decide si faltan datos.
4. Propone qué debe decir el bot.
5. Devuelve una acción estándar permitida.
6. El bot valida permisos, estado y datos antes de ejecutar nada.

## Ejecución como Goal de Codex

Esta sección existe para que Codex pueda ejecutar la feature como un goal
autónomo a partir de este archivo.

### Goal recomendado

```text
Implementar el intérprete LLM de órdenes naturales descrito en
llm-command-spec.md para el bot de Telegram, manteniendo las reglas de seguridad,
permisos, confirmación, grupos, privacidad, observabilidad y validación del repo.
```

### Alcance del goal

Codex debe implementar una primera versión funcional, testeada y desplegable del
asistente LLM. El alcance de implementación inicial incluye:

- Configuración runtime y feature flags.
- Servicio de invocación LLM usando proveedor configurable: `codex` por defecto
  mediante `GAMECLUB_CODEX_BIN`, y `opencode` como alternativa mediante
  `GAMECLUB_OPENCODE_BIN`.
- Prompt y contrato JSON tipado.
- Validación local de JSON, allowlist, permisos, contexto y confianza.
- Entrada por `/ask`.
- Botón privado "Preguntar al bot".
- Fallback automático en privado, apagable con
  `GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED`.
- Lecturas por mención o reply al bot en grupos/topics.
- MVP de lectura amplio definido en esta spec.
- Derivación de escritura en grupos a privado.
- Escritura en privado con prellenado, confirmación obligatoria y ejecución por
  handlers/servicios existentes.
- Rechazo de acciones administrativas con el copy definido.
- Sesión LLM de 15 minutos.
- Métricas saneadas sin guardar texto literal del usuario ni prompts completos.
- Tests unitarios suficientes para cubrir rutas principales, permisos y fallos.
- Actualización de `docs/feature-status.md` si la feature se implementa.

### Fuera del goal inicial

Codex no debe intentar resolver en el primer goal:

- Acciones administrativas por LLM.
- Memoria persistente por usuario.
- Interpretación automática en grupos sin mención.
- Ejecución directa de escritura saltándose handlers normales.
- Persistencia de conversaciones completas, prompts completos o texto literal de
  usuario.
- Sustitución de los menús existentes.
- Acceso directo a proveedores IA sin wrapper de usuario operador.

### Orden de trabajo recomendado

1. Leer `AGENTS.md`, esta spec y los flujos existentes de Telegram afectados.
2. Inspeccionar `src/telegram/runtime-boundary.ts`,
   `src/telegram/runtime-boundary-registration.ts`,
   `src/telegram/command-registry.ts`, `src/telegram/conversation-session.ts`,
   `src/telegram/action-menu.ts` y los flows de agenda, catálogo, Storage,
   compras, avisos, préstamos y LFG.
3. Implementar tipos, schema y parser JSON sin llamar todavía a OpenCode.
4. Implementar el servicio LLM con timeout, errores estructurados y tests con
   proceso mockeado.
5. Implementar router/allowlist de intenciones de lectura.
6. Conectar `/ask`, botón privado y fallback privado.
7. Conectar lectura en grupos con mención/reply, resumen público y detalle por
   privado.
8. Implementar sesiones multi-turno de 15 minutos y aclaraciones.
9. Implementar derivación de escrituras en grupo a privado.
10. Implementar escritura privada con prellenado, confirmación y handlers
    existentes para el subconjunto seguro de la fase.
11. Implementar rechazo de acciones admin.
12. Añadir métricas saneadas.
13. Actualizar documentación operativa y `docs/feature-status.md`.
14. Ejecutar validación completa antes de entregar.

### Archivos probables

Codex debe dejarse guiar por la estructura real del repo, pero los archivos más
probables son:

- `src/telegram/llm-command-flow.ts`
- `src/telegram/llm-command-prompt.ts`
- `src/telegram/llm-command-schema.ts`
- `src/telegram/llm-command-router.ts`
- `src/telegram/llm-command-actions.ts`
- `src/telegram/llm-command-session-store.ts`
- `src/telegram/llm-command-service.ts`
- `src/telegram/llm-command-flow.test.ts`
- `src/telegram/llm-command-router.test.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/command-registry.ts`
- `src/telegram/action-menu.ts`
- `src/telegram/i18n*.ts`
- `src/telegram/*flow.test.ts` de los dominios conectados
- `docs/feature-status.md`

Si el repo ya tiene helpers reutilizables para configuración, sesiones,
telemetría, permisos o envío Telegram, Codex debe preferirlos a crear
abstracciones paralelas.

### Checklist de implementación

- [ ] Feature flags cargadas desde entorno/config runtime.
- [ ] `GAMECLUB_CODEX_BIN`/`GAMECLUB_OPENCODE_BIN` usados en vez de hardcodear
  `codex` u `opencode`.
- [ ] Prompt generado desde catálogo tipado de capacidades.
- [ ] JSON validado con allowlist de intents y actions.
- [ ] Rechazo robusto de JSON inválido, texto no JSON y acciones desconocidas.
- [ ] Umbrales `0.75` lectura y `0.90` escritura aplicados localmente.
- [ ] `/ask` registrado como único comando textual.
- [ ] Botón "Preguntar al bot" añadido donde corresponda en Inicio privado.
- [ ] Fallback privado respeta comandos, botones, deep links y sesiones activas.
- [ ] Grupos sólo responden a mención explícita o reply al bot.
- [ ] Lectura en grupo resume y deriva detalle largo a privado.
- [ ] Escritura solicitada en grupo deriva a privado sin ejecutar.
- [ ] Escritura en privado pide confirmación siempre.
- [ ] Escritura confirmada usa handlers/servicios existentes.
- [ ] Acciones admin rechazan con: "Las acciones de admin no se hacen por IA.
  Usa el menú normal de admin."
- [ ] Sesiones LLM expiran a los 15 minutos.
- [ ] Métricas saneadas sin texto literal ni prompts completos.
- [ ] Tests cubren lectura, escritura, grupos, permisos, admin, fallos LLM y
  JSON inválido.
- [ ] `docs/feature-status.md` actualizado.

### Validación obligatoria

Al terminar cambios de código, Codex debe ejecutar como mínimo:

```bash
node --import tsx --test src/telegram/llm-command-flow.test.ts
node --import tsx --test src/telegram/llm-command-router.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```

Si hay cambios de schema, migraciones o Drizzle:

```bash
npm run db:check
```

Si hay fallos runtime tras `./startup.sh`, usar:

```bash
./scripts/service-journal.sh -n 200
```

### Condiciones de bloqueo

Codex debe detenerse y pedir decisión si:

- No existe una forma fiable de invocar `GAMECLUB_OPENCODE_BIN` desde el servicio.
- El wrapper OpenCode no permite obtener JSON de forma parseable y estable.
- Una capacidad de lectura requerida no tiene handler o repositorio claro.
- Una acción de escritura exigiría duplicar reglas de negocio en vez de reutilizar
  handlers/servicios existentes.
- La implementación requiere exponer texto literal de usuario, prompts completos
  o secretos en métricas/logs.
- Hay conflicto entre esta spec y `AGENTS.md`; en ese caso prevalece `AGENTS.md`
  para reglas operativas del repo y debe actualizarse la spec si procede.

### Definición de terminado

El goal se considera terminado cuando:

- Todos los criterios de aceptación de esta spec están implementados o queda
  documentado explícitamente qué criterio se pospone y por qué.
- Los tests nuevos y los tests de los flujos afectados pasan.
- `npm run typecheck` pasa.
- `./scripts/feature-status-audit.sh` pasa o sólo emite avisos explicados.
- `./startup.sh` completa correctamente.
- El bot queda desplegado y listo para probar en Telegram.
- El diff no incluye secretos, logs sensibles ni cambios no relacionados.

## Principios

- El bot conserva el control. La LLM nunca ejecuta acciones directamente.
- Las acciones se mapean a capacidades internas conocidas, no a comandos libres
  inventados.
- Los permisos se comprueban en el bot, aunque la LLM indique que una acción
  parece permitida.
- Todas las acciones de escritura requieren confirmación explícita, aunque sean
  simples y aunque el usuario escriba desde privado.
- Las acciones administrativas nunca se ejecutan por LLM. Si el usuario pide una
  acción de administrador, el bot debe pedirle que use el menú normal.
- Los usuarios no tienen que aprender comandos para usar el bot, pero las
  respuestas deben seguir pareciendo parte del bot actual.
- Si la LLM no tiene confianza suficiente, debe preguntar o derivar a ayuda.
- El diseño debe funcionar en español, catalán e inglés, con respuestas en el
  idioma del usuario cuando sea posible.

## Integración de IA

El servicio no debe invocar `codex` ni `opencode` directamente. Debe usar
siempre el binario configurado por entorno:

```bash
GAMECLUB_CODEX_BIN
GAMECLUB_OPENCODE_BIN
```

En despliegue estos valores apuntan a:

```bash
./scripts/codex-cawa.sh
./scripts/opencode-cawa.sh
```

Proveedor y modelo recomendados:

```bash
GAMECLUB_LLM_COMMANDS_PROVIDER=codex
GAMECLUB_LLM_COMMANDS_MODEL=gpt-5.4-mini
```

Configuración propuesta:

```bash
GAMECLUB_LLM_COMMANDS_ENABLED=false
GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED=true
GAMECLUB_LLM_COMMANDS_PROVIDER=codex
GAMECLUB_CODEX_BIN=./scripts/codex-cawa.sh
GAMECLUB_OPENCODE_BIN=./scripts/opencode-cawa.sh
GAMECLUB_LLM_COMMANDS_MODEL=gpt-5.4-mini
GAMECLUB_LLM_COMMANDS_REASONING_EFFORT=low
GAMECLUB_LLM_COMMANDS_TIMEOUT_MS=60000
GAMECLUB_LLM_COMMANDS_MAX_HISTORY=8
GAMECLUB_LLM_COMMANDS_SESSION_TTL_MINUTES=15
GAMECLUB_LLM_COMMANDS_MAX_PROMPT_CHARS=12000
GAMECLUB_LLM_COMMANDS_READ_CONFIDENCE_THRESHOLD=0.75
GAMECLUB_LLM_COMMANDS_WRITE_CONFIDENCE_THRESHOLD=0.90
GAMECLUB_LLM_COMMANDS_DRY_RUN=false
```

`GAMECLUB_LLM_COMMANDS_ENABLED` debe empezar desactivado por defecto para poder
desplegar código sin cambiar comportamiento real hasta activarlo expresamente.
`GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED` permite apagar sólo la
interpretación automática de mensajes privados sueltos, manteniendo `/ask`, el
botón "Preguntar al bot" y las consultas de lectura por mención en grupos.

Umbrales de confianza:

- Lectura: `0.75`. Por debajo, el bot debe pedir aclaración, ofrecer opciones o
  responder con ayuda.
- Escritura: `0.90`. Por debajo, el bot no debe preparar confirmación final; debe
  pedir aclaración o abrir el flujo normal sin ejecutar cambios.

## Activación en Telegram

Fase inicial recomendada:

- Sólo para usuarios aprobados.
- Entrada explícita mediante `/ask` o botón privado "Preguntar al bot".
- Fallback privado activado: si un mensaje privado no coincide con ningún
  comando, botón, deep link o sesión activa, el bot debe intentar interpretarlo
  con la LLM.
- En grupos y supergrupos, sólo para acciones de lectura y sólo cuando el
  usuario mencione explícitamente al bot o responda a un mensaje suyo.

Regla obligatoria de contexto:

- Las acciones de lectura pueden ejecutarse y responderse en cualquier grupo,
  supergrupo o topic donde el bot esté presente, siempre que la petición mencione
  al bot o sea una respuesta directa a un mensaje del bot.
- Las acciones de escritura deben hacerse siempre en chat privado. Si el usuario
  pide desde un grupo crear, editar, borrar, archivar, publicar, unirse,
  apuntarse, confirmar, configurar o cambiar cualquier recurso, el bot no debe
  ejecutar la acción en el grupo. Debe responder con una derivación breve a
  privado y pedir al usuario que repita allí el mensaje.
- En grupos no debe haber interpretación automática de mensajes que no mencionen
  al bot. Esto evita ruido, coste y ambigüedad sobre si el usuario está hablando
  con el bot o con otras personas.

### Respuestas de lectura en grupos

Cuando una consulta de lectura se haga desde un grupo o topic, el bot debe
responder en el grupo con un resumen breve y ofrecer el detalle por privado.

Regla recomendada:

- Si hay 0 resultados, responder el vacío en el grupo.
- Si hay 1-5 resultados, mostrar el resumen en el grupo y ofrecer ampliar por
  privado si hay más contexto disponible.
- Si hay más de 5 resultados, mostrar sólo los 5 más relevantes o recientes en
  el grupo y añadir un enlace/botón para continuar en privado.
- No pegar listados largos en grupos.
- Si el resultado contiene información personal o sensible, responder en grupo
  sólo con una derivación a privado.

Ejemplo:

```text
He encontrado 12 archivos relacionados con Dragon Ball. Te dejo los 5 primeros:

1. Goku SSJ.stl
2. Vegeta base.stl
3. Shenron soporte.stl
4. Cápsula Hoi-Poi.stl
5. Freezer busto.stl

Para ver la lista completa, ábreme por privado.
```

Ejemplo de derivación a privado:

```text
Puedo ayudarte con eso, pero las acciones que cambian algo las hago sólo por
privado. Escríbeme este mismo mensaje en el chat privado y lo seguimos allí.
```

## Nombre Visible

La entrada principal del asistente en menús y botones debe llamarse:

```text
Preguntar al bot
```

Este nombre se usará para el botón privado de Inicio y cualquier acceso visible
equivalente. El único comando textual del asistente será:

```text
/ask
```

## Alcance Funcional

La ambición final es que el usuario pueda pedir por lenguaje natural cualquier
acción que ya tenga derecho a hacer por comandos o menús.

### Consultas de lectura

- Ver actividades de hoy.
- Ver próximas actividades.
- Buscar actividades por fecha, mesa, juego, organizador o plazas.
- Buscar en catálogo por título, título original, editorial, tipo, familia,
  grupo, disponibilidad, jugadores, edad, duración o propietario.
- Consultar detalle de un item del catálogo.
- Buscar en Storage por texto, categoría, subcategoría, tag, tipo de archivo,
  nombre visible o extensión.
- Listar STL, imágenes, vídeos, documentos o audios guardados.
- Ver préstamos propios, préstamos activos o préstamos vencidos si tiene permiso.
- Consultar compras conjuntas abiertas.
- Consultar avisos activos.
- Consultar búsquedas LFG activas.
- Consultar perfil o espacio propio cuando existan datos visibles.
- Consultar estado básico no administrativo de noticias o suscripciones
  visibles para el usuario.
- Preguntar qué puede hacer el bot.

### Acciones de usuario aprobado

- Unirse a una actividad cuando el flujo existente lo permita.
- Salir de una actividad.
- Crear una actividad si el usuario ya puede hacerlo por flujo normal.
- Crear o editar una búsqueda LFG.
- Participar en una compra conjunta.
- Responder datos pendientes de una compra conjunta.
- Crear un aviso privado para publicar en destinos `/news avisos`, si se cumplen
  las reglas existentes.
- Archivar sus propios avisos.
- Subir contenido a Storage si tiene permiso sobre la categoría.
- Buscar categoría adecuada antes de subir a Storage.
- Iniciar préstamo de un item disponible.
- Ver o actualizar su perfil cuando existan flujos para ello.

### Ejecución de escritura

Las acciones de escritura en privado deben seguir un modelo híbrido:

- La LLM puede interpretar la intención, extraer parámetros y prellenar datos
  del flujo normal.
- La LLM puede saltar preguntas obvias si el mensaje ya contiene datos válidos.
- La LLM no debe crear un camino de ejecución paralelo.
- La ejecución final debe pasar por el handler, servicio o flujo estándar del
  bot para esa capacidad.
- La confirmación final del bot se conserva siempre antes de persistir cambios,
  publicar, unirse, archivar, subir archivos o modificar cualquier recurso.
- Si faltan datos o hay ambigüedad, el bot debe continuar con preguntas guiadas
  compatibles con el flujo normal.

Ejemplo: si el usuario dice "crea un aviso diciendo que mañana abrimos media
hora más tarde", la LLM puede proponer `notice.create` con el texto prellenado,
pero el bot debe mostrar resumen, pedir confirmación y ejecutar por el flujo de
Avisos existente.

### Acciones administrativas

Las acciones administrativas quedan fuera del alcance de la LLM. Nunca se deben
ejecutar desde esta feature, aunque el usuario sea admin y aunque escriba desde
privado.

Si el mensaje pide gestionar capacidades administrativas, el bot debe responder
que esa operación se hace desde el menú normal de administrador. Esto aplica a:

- Crear, editar o cancelar actividades como admin.
- Gestionar catálogo como admin.
- Gestionar préstamos como admin.
- Gestionar compras conjuntas como admin.
- Gestionar avisos de cualquier usuario.
- Configurar o consultar `/news` como admin.
- Gestionar categorías y permisos de Storage.
- Consultar estado del servicio o resúmenes admin.
- Usar capacidades del panel admin.

Ejemplo de respuesta:

```text
Las acciones de admin no se hacen por IA. Usa el menú normal de admin.
```

## Fuera de Alcance Inicial

- Dar a la LLM acceso directo a base de datos, tokens, hashes o configuración
  sensible.
- Permitir que la LLM genere SQL, comandos shell o callbacks arbitrarios.
- Ejecutar acciones destructivas sin confirmación.
- Publicar automáticamente en grupos desde una petición ambigua.
- Sustituir los flujos existentes por conversaciones libres sin validación.
- Usar la LLM como fuente de datos sobre catálogo, actividades o Storage. Los
  datos deben venir siempre de repositorios internos del bot.

## Arquitectura Recomendada

Componentes nuevos:

- `src/telegram/llm-command-flow.ts`: entrada Telegram, respuestas, progreso y
  coordinación de sesión.
- `src/telegram/llm-command-prompt.ts`: descripción de capacidades, reglas y
  formato de salida.
- `src/telegram/llm-command-schema.ts`: contrato JSON, tipos y validación.
- `src/telegram/llm-command-router.ts`: mapeo de intención a handlers internos.
- `src/telegram/llm-command-actions.ts`: catálogo tipado de acciones permitidas.
- `src/telegram/llm-command-session-store.ts`: sesiones multi-turno.
- `src/telegram/llm-command-service.ts`: invocación de `GAMECLUB_OPENCODE_BIN`.
- `src/telegram/llm-command-flow.test.ts`: pruebas de flujo.
- `src/telegram/llm-command-router.test.ts`: pruebas de mapeo y permisos.

El flujo general:

```text
mensaje usuario
  -> comprobación de sesión activa
  -> prompt LLM con capacidades permitidas
  -> JSON validado
  -> comprobación de confianza
  -> comprobación local de permisos
  -> aclaración, confirmación o ejecución
  -> handler estándar del bot
  -> respuesta final
```

## Contrato JSON

La LLM debe responder sólo JSON. El bot debe rechazar cualquier respuesta que no
cumpla el esquema.

```json
{
  "version": 1,
  "language": "es",
  "intent": "storage.search",
  "confidence": 0.91,
  "reply": {
    "text": "Busco STL de Dragon Ball en Storage.",
    "sendNow": false
  },
  "needsClarification": false,
  "clarification": null,
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "call_internal_handler",
    "name": "storage.search",
    "params": {
      "query": "Dragon Ball",
      "fileExtensions": ["stl"]
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "read_only",
    "publicSideEffect": false,
    "destructive": false,
    "requiresPrivateChat": false
  }
}
```

Campos:

- `version`: versión del contrato.
- `language`: idioma detectado para responder.
- `intent`: intención normalizada.
- `confidence`: número entre `0` y `1`.
- `reply.text`: texto sugerido para el usuario.
- `reply.sendNow`: si conviene enviar ese texto antes de ejecutar.
- `needsClarification`: indica que falta información.
- `clarification`: pregunta y campos esperados.
- `requiresConfirmation`: indica que el bot debe pedir confirmación antes de
  ejecutar.
- `confirmation`: resumen humano de lo que se va a hacer.
- `action`: acción permitida y parámetros.
- `safety`: clasificación declarativa para validación local.

El bot debe comparar `confidence` con el umbral correspondiente según
`safety.risk` o el tipo de acción validado localmente. La clasificación de la
LLM no es autoritativa: si el bot detecta escritura, se aplica el umbral de
escritura.

`safety.requiresPrivateChat` debe ser `true` para cualquier acción que no sea
puramente de lectura. El bot debe imponer esta regla aunque la LLM no la marque
correctamente.

Valores iniciales de `action.type`:

- `answer_directly`
- `ask_clarification`
- `request_confirmation`
- `call_internal_handler`
- `dispatch_command`
- `unsupported`

`dispatch_command` sólo debe aceptarse para una lista cerrada de comandos
seguros. Para acciones complejas es preferible `call_internal_handler`.

## Intenciones Iniciales

```text
help.capabilities
schedule.today
schedule.upcoming
schedule.search
schedule.create
schedule.join
schedule.leave
catalog.search
catalog.detail
catalog.create
catalog.edit
catalog.loan.create
catalog.loan.list
storage.search
storage.category.list
storage.upload.start
storage.entry.detail
storage.entry.edit
notice.list
notice.create
notice.archive
group_purchase.list
group_purchase.detail
group_purchase.join
group_purchase.create
lfg.list
lfg.create
news.status
clarify
unsupported
```

Esta lista debe vivir en código como allowlist. El prompt puede describirla, pero
el bot debe validarla localmente.

## Aclaraciones Multi-Turno

Cuando falte información, la LLM debe pedir sólo lo necesario para avanzar.

Ejemplo:

```json
{
  "version": 1,
  "language": "es",
  "intent": "catalog.search",
  "confidence": 0.82,
  "reply": {
    "text": "¿Quieres buscar sólo juegos de mesa, sólo libros o todo el catálogo?",
    "sendNow": true
  },
  "needsClarification": true,
  "clarification": {
    "question": "¿Quieres buscar sólo juegos de mesa, sólo libros o todo el catálogo?",
    "expectedFields": ["itemTypes"],
    "knownParams": {
      "query": "El Señor de los Anillos"
    }
  },
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "ask_clarification",
    "name": "catalog.search",
    "params": {
      "query": "El Señor de los Anillos"
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "read_only",
    "publicSideEffect": false,
    "destructive": false,
    "requiresPrivateChat": false
  }
}
```

La sesión debe guardar:

- `userId`
- `chatId`
- `language`
- `originalMessage`
- `intent`
- `knownParams`
- `history`
- `createdAt`
- `expiresAt`

Caducidad obligatoria: 15 minutos desde la última interacción de la sesión LLM.
El asistente no debe usar mensajes anteriores fuera de esa sesión ni memoria
persistente por usuario.

## Confirmaciones

El bot debe pedir confirmación para cualquier acción de escritura. A efectos de
esta feature, "escritura" incluye crear, editar, borrar, archivar, cancelar,
publicar, unirse, salir, apuntarse, confirmar, configurar, subir archivos o
cambiar cualquier recurso persistente.

También debe pedir confirmación si:

- La acción afecta a otros usuarios.
- La confianza de la LLM es aceptable pero no alta.
- Hay varios recursos parecidos y la selección no es inequívoca.

Ejemplo de confirmación:

```text
Voy a publicar este aviso en los destinos suscritos a /news avisos:

"Mañana se retrasa la partida de rol a las 19:30."

¿Lo publico?
```

La confirmación debe usar botones de Telegram cuando sea posible.

## Seguridad y Privacidad

El prompt no debe incluir:

- Tokens.
- Hashes.
- Contraseñas.
- Configuración secreta.
- IDs internos innecesarios.
- Mensajes privados de otros usuarios.
- Datos de Storage que el usuario no pueda leer.

El contexto permitido para la LLM:

- Texto actual del usuario.
- Idioma preferido o detectado.
- Rol resumido: usuario aprobado, admin, no aprobado.
- Chat: privado o grupo, y si hay topic.
- Lista de capacidades permitidas para ese usuario.
- Historial breve de la sesión LLM actual.
- Resultados acotados cuando sean necesarios para desambiguar.
- No se debe incluir historial ajeno a la sesión LLM activa.

El bot debe registrar errores y decisiones con datos saneados. No debe guardar
prompts completos con contenido sensible salvo que exista una política explícita
de auditoría y redacción.

## Observabilidad

La feature debe guardar métricas saneadas para medir calidad sin persistir
conversaciones completas ni texto literal del usuario.

Campos recomendados:

- Fecha/hora.
- Usuario interno o hash estable, si ya existe un patrón seguro en el bot.
- Tipo de chat: privado, grupo, supergrupo o topic.
- Entrada: `/ask`, botón, fallback privado, mención en grupo o reply al bot.
- Idioma detectado.
- Intención normalizada.
- Confianza devuelta por la LLM.
- Tipo de acción: lectura, escritura, aclaración, confirmación, rechazo,
  derivación a privado, derivación a menú admin o unsupported.
- Motivo de aclaración, rechazo o fallo.
- Duración de la llamada LLM.
- Resultado: éxito, timeout, JSON inválido, acción no allowlisted, permiso
  denegado, error de handler o cancelado por usuario.

No guardar:

- Texto literal del usuario.
- Prompt completo.
- Respuesta completa de la LLM.
- Resultados completos de catálogo, Storage, agenda u otros repositorios.
- Tokens, hashes, datos privados o adjuntos.

## Permisos

La LLM puede sugerir campos de seguridad, pero esas señales no son
autoritativas.

Validación local obligatoria:

- Usuario aprobado para capacidades de socio.
- Permisos por recurso para Storage.
- Permisos de propietario para avisos, o reglas explícitas no administrativas
  del flujo correspondiente.
- Permisos de alta/edición para catálogo, agenda, compras y préstamos.
- Contexto correcto: privado, grupo o topic según acción.
- Chat privado obligatorio para cualquier acción de escritura, incluso si el
  usuario tiene permisos suficientes y aunque sea admin.
- Rechazo de cualquier acción administrativa, derivando al menú normal de admin.

Si el usuario no tiene permiso, el bot debe responder con el mensaje estándar o
un equivalente natural, sin revelar detalles internos.

## Prompt de Capacidades

El prompt debe describir el bot como un sistema con herramientas permitidas.
Debe ser compacto y generado desde una fuente tipada, no escrito a mano en varias
copias.

Ejemplo conceptual:

```text
Eres el intérprete de órdenes del bot del club. Tu trabajo es convertir el
mensaje del usuario en JSON válido. No inventes acciones. No ejecutes nada. Si
faltan datos, pide una aclaración. Si una acción cambia datos o publica mensajes,
marca requiresConfirmation=true para cualquier acción de escritura.

Usuario:
- idioma preferido: es
- aprobado: true
- admin: false
- chat: privado

Acciones permitidas:
- schedule.today: consultar actividades de hoy
- schedule.upcoming: consultar próximas actividades
- catalog.search: buscar items del catálogo
- storage.search: buscar entradas de Storage visibles para el usuario
...
```

## Ejemplos Esperados

### Actividades de hoy

Usuario:

```text
oye bot, ¿qué actividades hay hoy en el club?
```

Salida:

```json
{
  "version": 1,
  "language": "es",
  "intent": "schedule.today",
  "confidence": 0.95,
  "reply": {
    "text": "Te miro las actividades de hoy.",
    "sendNow": false
  },
  "needsClarification": false,
  "clarification": null,
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "call_internal_handler",
    "name": "schedule.today",
    "params": {
      "date": "today"
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "read_only",
    "publicSideEffect": false,
    "destructive": false,
    "requiresPrivateChat": false
  }
}
```

### Búsqueda de catálogo

Usuario:

```text
¿tenemos algún juego de mesa de El Señor de los Anillos?
```

Salida:

```json
{
  "version": 1,
  "language": "es",
  "intent": "catalog.search",
  "confidence": 0.9,
  "reply": {
    "text": "Busco juegos de mesa relacionados con El Señor de los Anillos.",
    "sendNow": false
  },
  "needsClarification": false,
  "clarification": null,
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "call_internal_handler",
    "name": "catalog.search",
    "params": {
      "query": "El Señor de los Anillos",
      "itemTypes": ["board_game", "expansion"]
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "read_only",
    "publicSideEffect": false,
    "destructive": false,
    "requiresPrivateChat": false
  }
}
```

### Búsqueda de STL en Storage

Usuario:

```text
dame una lista de los STL de Dragon Ball que tengamos subidos
```

Salida:

```json
{
  "version": 1,
  "language": "es",
  "intent": "storage.search",
  "confidence": 0.93,
  "reply": {
    "text": "Busco archivos STL de Dragon Ball en Storage.",
    "sendNow": false
  },
  "needsClarification": false,
  "clarification": null,
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "call_internal_handler",
    "name": "storage.search",
    "params": {
      "query": "Dragon Ball",
      "fileExtensions": ["stl"],
      "mimeTypes": ["model/stl"]
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "read_only",
    "publicSideEffect": false,
    "destructive": false,
    "requiresPrivateChat": false
  }
}
```

### Escritura solicitada desde grupo

Usuario en un grupo:

```text
@bot crea un aviso diciendo que mañana abrimos media hora más tarde
```

Salida:

```json
{
  "version": 1,
  "language": "es",
  "intent": "notice.create",
  "confidence": 0.92,
  "reply": {
    "text": "Puedo ayudarte con eso, pero las acciones que cambian algo las hago sólo por privado. Escríbeme este mismo mensaje en el chat privado y lo seguimos allí.",
    "sendNow": true
  },
  "needsClarification": false,
  "clarification": null,
  "requiresConfirmation": false,
  "confirmation": null,
  "action": {
    "type": "unsupported",
    "name": "private_chat_required",
    "params": {
      "targetIntent": "notice.create"
    }
  },
  "safety": {
    "requiresApprovedMember": true,
    "requiresAdmin": false,
    "risk": "write",
    "publicSideEffect": true,
    "destructive": false,
    "requiresPrivateChat": true
  }
}
```

## Observaciones y Recomendaciones

Recomendación principal: empezar por consultas de sólo lectura, incluidas
consultas desde grupos cuando mencionen al bot, y ampliar después. Las tres
peticiones originales se resuelven con lectura de agenda, catálogo y Storage.
Esto permite validar calidad, coste, latencia y UX sin abrir riesgos de
publicación o edición.

No conviene modelarlo como "ChatGPT con acceso al bot". Conviene modelarlo como
un router semántico con un catálogo cerrado de acciones. Esa diferencia reduce
riesgo, simplifica tests y mantiene el comportamiento dentro de los contratos
existentes.

El bot debe reutilizar los handlers actuales siempre que sea razonable. Si una
capacidad ya existe como flujo Telegram, la feature LLM debe llegar a ese flujo
con parámetros prellenados, no duplicar reglas de negocio. Para escritura, esto
es obligatorio: no debe haber una ruta LLM que persista cambios saltándose el
handler o servicio estándar.

Para acciones largas, se debe usar mensaje de progreso editable:

```text
Entendiendo la petición...
Buscando en Storage...
Preparando resultados...
```

Si Telegram no permite editar el mensaje, se debe enviar el resultado final como
mensaje nuevo y registrar el fallo de edición como warning estructurado.

En privado, el asistente puede ser conversacional. En grupos, debe ser discreto:
responder sólo cuando lo mencionen explícitamente o cuando se pulse un botón que
abra el flujo privado. Las respuestas de lectura sí pueden quedarse en el grupo,
pero deben ser resúmenes cortos; el detalle completo se ofrece por privado. Las
acciones de escritura siempre deben moverse al privado, incluso si el usuario es
admin.

Las acciones con resultados múltiples deben preferir selección guiada con
botones o enlaces profundos. Por ejemplo, si una búsqueda de catálogo devuelve
varios items parecidos, el bot no debe asumir uno sin confirmación.

La LLM no debe resolver búsquedas contra su memoria. Para "Dragon Ball", "El
Señor de los Anillos" o cualquier otro término, la respuesta real debe venir de
los repositorios internos.

## Fases de Implementación

### Fase 1: lectura privada y lectura en grupos con mención

- Configuración de entorno.
- Servicio LLM con proveedor Codex por defecto, timeout, schema de salida y
  parseo JSON.
- Prompt de capacidades inicial.
- Esquema JSON y validación.
- `/ask` en privado.
- Fallback automático para mensajes privados que no encajen con comandos,
  botones, deep links o sesiones activas.
- Mención explícita del bot en grupos para consultas de lectura.
- Agenda: hoy y próximas actividades.
- Catálogo: búsqueda y detalle.
- Storage: búsqueda por texto, tag y extensión.
- Compras conjuntas abiertas.
- Avisos activos.
- Préstamos propios.
- Búsquedas LFG activas.
- Perfil o mi espacio.
- Estado básico no administrativo de noticias.
- Ayuda de capacidades.
- Tests unitarios con LLM mockeada.

### Fase 2: conversación y desambiguación

- Sesión multi-turno.
- Aclaraciones.
- Selección entre múltiples resultados.
- Reintento si la LLM devuelve JSON inválido.
- Respuestas en idioma del usuario.
- Métricas de intención, confianza y errores.

### Fase 3: acciones con confirmación

- Prellenado de flujos normales a partir de lenguaje natural.
- Confirmación obligatoria antes de la ejecución final.
- Crear aviso.
- Crear actividad.
- Unirse a actividad.
- Participar en compra conjunta.
- Crear LFG.
- Iniciar préstamo.
- Subir a Storage con categoría preseleccionada.

### Fase 4: ampliación de acciones no administrativas

- Completar más flujos de socio.
- Mejorar creación de actividad no administrativa si el flujo normal lo permite.
- Mejorar creación y edición de LFG.
- Mejorar participación en compras conjuntas.
- Mejorar subida guiada a Storage.
- Mantener las acciones administrativas fuera de la LLM y derivadas al menú
  normal de admin.

### Fase 5: refinamiento de grupos

- Sólo con mención explícita o reply al bot.
- Sin conversaciones largas en público.
- Respuestas de lectura resumidas directamente en el grupo o topic.
- Detalle completo de resultados largos por privado.
- Derivación obligatoria a privado para cualquier acción de escritura,
  configuración, publicación o participación.
- Derivación a privado para acciones personales o ambiguas.
- Respeto estricto de topics cuando aplique.

## Pruebas

Pruebas mínimas:

- Parseo válido de JSON.
- Rechazo de JSON inválido.
- Rechazo de acción no allowlisted.
- Rechazo de cualquier acción administrativa con derivación al menú normal de
  admin.
- Rechazo de acción de escritura en grupo con derivación a privado.
- Ejecución de acción de lectura en grupo cuando el usuario menciona al bot.
- Resumen en grupo y detalle por privado cuando una lectura devuelve más de 5
  resultados.
- Ignorar mensajes de grupo sin mención explícita al bot.
- Rechazo de Storage sin permiso de lectura.
- Pregunta de aclaración cuando faltan parámetros.
- Pregunta de aclaración o ayuda cuando una lectura queda por debajo de `0.75`.
- Pregunta de aclaración cuando una escritura queda por debajo de `0.90`.
- Confirmación para cualquier acción de escritura en privado.
- Mapeo de los tres ejemplos originales.
- Timeout del proveedor LLM.
- Fallback cuando la LLM falla.
- No mezclar `replyKeyboard` e `inlineKeyboard` en el mismo mensaje cuando haya
  acciones inline.

Comandos esperados cuando se implemente:

```bash
node --import tsx --test src/telegram/llm-command-flow.test.ts
node --import tsx --test src/telegram/llm-command-router.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```

Si hay cambios de esquema o migraciones:

```bash
npm run db:check
```

## Criterios de Aceptación

- Un mensaje privado de usuario aprobado que no encaja con ningún flujo activo
  se interpreta con la LLM.
- Un usuario aprobado puede consultar actividades de hoy con lenguaje natural.
- Un usuario aprobado puede consultar actividades, catálogo y Storage desde un
  grupo mencionando al bot.
- Las consultas de lectura en grupo muestran resumen público y derivan a privado
  para el detalle cuando hay resultados largos.
- Un usuario aprobado puede buscar en catálogo con lenguaje natural.
- Un usuario aprobado puede buscar STL u otros archivos en Storage con lenguaje
  natural, respetando permisos.
- Un usuario aprobado puede consultar compras conjuntas abiertas, avisos activos,
  préstamos propios, LFG, perfil y estado básico no administrativo de noticias
  con lenguaje natural.
- Una petición de escritura enviada desde grupo no ejecuta cambios y deriva al
  usuario a privado para repetir el mensaje.
- El bot pide aclaración cuando la petición es ambigua.
- El bot aplica umbral `0.75` para lecturas y `0.90` para escrituras.
- El bot pide confirmación antes de cualquier acción de escritura.
- El bot no ejecuta acciones no declaradas en la allowlist.
- El bot no permite que la LLM salte permisos.
- El bot no ejecuta acciones administrativas por LLM y siempre deriva al menú
  normal de admin.
- La feature puede apagarse por configuración sin tocar código.
- Los fallos de LLM degradan a una respuesta útil, no a error silencioso.

## Riesgos

- Latencia: cada petición LLM añade espera antes de ejecutar.
- Coste: el fallback automático en mensajes privados puede multiplicar llamadas.
- Ambigüedad: mensajes cortos pueden mapear a varias capacidades.
- Seguridad: una salida malformada o una intención demasiado amplia podría
  ejecutar algo no deseado si no se valida localmente.
- UX: demasiadas aclaraciones pueden ser más lentas que usar el menú.
- Mantenimiento: cada nueva capacidad del bot debería añadirse al catálogo de
  acciones LLM si se quiere hacer accesible por lenguaje natural.

Mitigaciones:

- Feature flag.
- Allowlist estricta.
- Umbral de confianza.
- Confirmaciones obligatorias.
- Tests con LLM mockeada.
- Métricas y logs saneados.
- Activación gradual.

## Pendientes de Decisión

No quedan decisiones abiertas de producto para esta especificación inicial.
