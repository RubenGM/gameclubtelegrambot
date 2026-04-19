# Telegram Menu UX Telemetry Design

## Goal

Mejorar dos aspectos del bot en una sola iteracion pequena y medible:

- hacer mas consistente el lenguaje visual del menu principal
- registrar telemetria UX basica del menu principal en base de datos

La UX objetivo es:

- que el menu principal use etiquetas coherentes entre si y entre idiomas
- que el orden de las acciones sea predecible por rol
- que podamos responder con datos reales a preguntas como que botones se usan mas y que menús se muestran mucho pero reciben poca interaccion

## Scope

La v1 cubre solo:

- el menu principal persistente resuelto en `src/telegram/action-menu.ts`
- la deteccion de pulsaciones de botones de ese menu en `src/telegram/runtime-boundary-registration.ts`
- el registro de eventos UX en la infraestructura ya existente de `audit_log`
- los textos visibles del menu en `src/telegram/i18n-common.ts`
- tests unitarios del menu y del runtime Telegram

La v1 no cubre:

- inline keyboards
- callbacks de detalle dentro de actividades, catalogo o mesas
- analitica completa de todos los flujos conversacionales
- paneles de reporting o comandos de consulta para operadores
- cambios grandes de copy fuera del menu principal

## Current Project Context

El bot ya tiene dos piezas que conviene reaprovechar en lugar de inventar otra capa:

- `src/telegram/action-menu.ts` centraliza la composicion visual del menu principal por rol y contexto
- `src/audit/audit-log-store.ts` y la tabla `audit_log` ya permiten persistir eventos genericos con `actionKey`, `targetType`, `targetId`, `summary` y `details`

Hoy, la consistencia visual del menu depende sobre todo de decisiones implicitas en dos sitios:

- `actionDefinitions`, que define labels y visibilidad
- `menuDefinitions`, que define el orden visual de las filas

Esto funciona, pero todavia no deja claro cuales son las reglas UX que deben mantenerse cuando se anadan nuevas acciones.

Ademas, el runtime detecta botones traducidos comparando textos visibles, pero no conserva una representacion explicita del menu mostrado ni de la accion seleccionada como dato de producto. Eso impide medir uso real del menu sin repartir logs ad hoc por varios handlers.

## Approaches Considered

### 1. Tabla nueva de telemetria UX

Ventaja: modelo dedicado y muy limpio para producto.

Inconveniente: abre migracion y capa de acceso nueva cuando ya existe `audit_log` con la estructura suficiente para esta v1.

### 2. Reutilizar `audit_log` con eventos UX del menu principal

Ventaja: cambio pequeno, coherente con el repositorio y suficiente para una v1.

Inconveniente: mezcla eventos UX con auditoria operativa, asi que las consultas tendran que filtrar por `actionKey`.

### 3. Solo logs de aplicacion

Ventaja: implementacion muy barata.

Inconveniente: no deja una base consultable y durable para comparar uso entre despliegues.

La opcion recomendada es la 2.

## Recommended Architecture

### 1. Menu Metadata Becomes Explicit

`resolveTelegramActionMenu()` debe dejar de ser solo un constructor de `replyKeyboard` y pasar a devolver tambien metadatos UX del menu resuelto.

La estructura recomendada es:

- `menuId`: id estable del menu resuelto, por ejemplo `private-approved-default`
- `replyKeyboard`: matriz visible actual
- `actionRows`: matriz paralela de `actionId` visibles en el mismo orden que el teclado
- `actions`: mapa o lista plana con metadatos por accion visible

Esto evita tener que deducir despues, a partir del texto traducido, que menu se mostro realmente y que accion concreta lo componia.

### 2. Action Definitions Carry UX Semantics

Cada accion principal del menu debe tener una pequena semantica UX explicita en `actionDefinitions`.

La v1 no necesita una taxonomia compleja. Basta con anadir:

- `telemetryActionKey`: clave estable como `menu.schedule` o `menu.catalog`
- `uxSection`: categoria simple como `primary`, `admin`, `utility`, `access`

No hace falta persistir una columna nueva en base de datos para estas propiedades. Su funcion es:

- ordenar y revisar visualmente el menu con reglas claras
- registrar la accion por una clave estable y no por el texto traducido

### 3. Visual Consistency Rules Live Near the Menu

Las reglas de consistencia del menu principal deben quedar reflejadas en el propio modulo del menu y en sus tests.

Reglas de v1:

- maximo 2 botones por fila
- utilidades siempre al final del menu
- nada de acciones de debug en menus normales
- las acciones de acceso van antes que utilidades
- las etiquetas visibles del mismo menu deben seguir el mismo estilo corto y accionable

La implementacion no necesita un linter generico. Basta con reforzar estas reglas con tests sobre `resolveTelegramActionMenu()` para cada rol principal.

### 4. Telemetry Uses Existing Audit Infrastructure

La v1 debe registrar eventos UX en `audit_log` reutilizando `createDatabaseAuditLogRepository()`.

Eventos:

- `telegram.menu.shown`
- `telegram.menu.action_selected`

Convencion recomendada:

- `targetType`: `telegram-menu`
- `targetId`: `menuId`
- `summary`: frase corta legible para humanos
- `details`: JSON con contexto UX

`details` para `telegram.menu.shown`:

- `chatKind`
- `actorRole` con valores `pending`, `member`, `admin`, `blocked` si aplica
- `language`
- `visibleActionIds`
- `visibleLabels`

`details` para `telegram.menu.action_selected`:

- `chatKind`
- `actorRole`
- `language`
- `menuId`
- `actionId`
- `telemetryActionKey`
- `label`

### 5. Instrumentation Points Stay Narrow

La telemetria debe instrumentarse solo en dos sitios:

- cuando el runtime adjunta el menu principal actual a una respuesta persistente
- cuando entra un texto que coincide con una accion visible del menu principal

Esto permite cubrir el menu principal sin contaminar la v1 con callbacks o flujos internos.

La deteccion de seleccion no debe volver a depender del texto por libre en varios `if`. Conviene anadir un helper pequeno, por ejemplo `resolveTelegramMenuSelection()`, que reciba contexto y texto y devuelva:

- `menuId`
- `actionId`
- `label`
- `telemetryActionKey`

Despues, el runtime puede:

1. registrar `telegram.menu.action_selected`
2. ejecutar el handler ya existente para esa accion

## Data Flow

### Flow 1: Menu shown to approved member

1. El runtime construye una respuesta que incluye el menu principal persistente.
2. `resolveTelegramActionMenu()` devuelve `menuId`, `replyKeyboard` y acciones visibles.
3. El runtime responde al usuario con ese teclado.
4. El runtime registra `telegram.menu.shown` con `menuId = private-approved-default` y el listado de acciones visibles.

### Flow 2: Member taps `Taules`

1. El usuario envia el texto visible del boton.
2. `resolveTelegramMenuSelection()` comprueba el menu visible para ese contexto y encuentra la coincidencia.
3. El runtime registra `telegram.menu.action_selected` con `actionId = tables_read` y `telemetryActionKey = menu.tables`.
4. El runtime ejecuta `handleTelegramTableReadCommand()`.

### Flow 3: Pending user taps `Acces al club`

1. El usuario pendiente pulsa `Acces al club`.
2. El runtime resuelve esa accion como seleccion del menu principal pendiente.
3. Se registra `telegram.menu.action_selected` para `menu.access`.
4. Se reutiliza el flujo ya existente de solicitud automatica de acceso.

## Error Handling

- Si el menu actual no puede resolverse para un contexto, no se debe registrar telemetria UX y el runtime debe comportarse como hoy.
- Si el texto recibido no coincide con una accion visible del menu principal, no se registra `telegram.menu.action_selected`.
- Si la insercion en `audit_log` falla, el bot no debe romper la UX principal del usuario. La telemetria debe degradar de forma segura y dejar constancia via logger si ya existe esa ruta de error cercana.
- Si una accion visible cambia de label por idioma, la telemetria debe seguir agrupando por `actionId` o `telemetryActionKey`, nunca por label traducido.

## Testing

Los tests deben ampliarse para cubrir:

- que `resolveTelegramActionMenu()` devuelve metadatos del menu ademas del teclado visible
- que los menus principales siguen respetando el orden y la agrupacion esperados por rol
- que al mostrar un menu persistente se registra `telegram.menu.shown`
- que al pulsar `Acces al club`, `Taules`, `Cataleg`, `Ajuda` u otras acciones principales se registra `telegram.menu.action_selected`
- que la clave registrada usa `actionId` estable y no depende del label traducido
- que un fallo al persistir telemetria no rompe la respuesta principal del bot

No hace falta abrir una suite nueva. Este trabajo cabe dentro de `action-menu.test.ts`, `runtime-boundary.test.ts` y los tests del repositorio de auditoria si se necesita una ampliacion puntual.

## Acceptance Criteria

- El menu principal sigue renderizando el mismo conjunto de acciones validadas con el usuario, con orden coherente por rol.
- `resolveTelegramActionMenu()` expone suficiente metadata para saber que menu se ha mostrado y que acciones contenia.
- El bot registra `telegram.menu.shown` cada vez que adjunta un menu principal persistente.
- El bot registra `telegram.menu.action_selected` cuando el usuario pulsa una accion del menu principal.
- Los eventos se guardan en `audit_log` reutilizando la infraestructura existente.
- La telemetria usa claves estables por accion y no depende del texto visible.
- Un fallo al guardar telemetria no rompe los flujos del usuario.
- La suite de tests cubre tanto consistencia visual como registro de telemetria del menu principal.
