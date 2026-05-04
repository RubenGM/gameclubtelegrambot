# Group Purchases Design

## Goal

Anadir una nueva seccion de `Compras conjuntas` al bot para coordinar compras compartidas entre socios del club desde chat privado.

La UX objetivo es:

- permitir crear una compra conjunta con titulo, descripcion operativa y modo de compra
- soportar dos modelos de reparto: coste compartido proporcional y compra por unidades
- permitir que cada compra defina sus propios campos configurables para recoger opciones por participante
- dejar que los usuarios se apunten, editen sus datos y sigan el estado de la compra
- permitir que el creador gestione la compra, cambie estados y publique mensajes privados solo a personas apuntadas
- mantener deep links y vistas de detalle consistentes con los patrones ya usados en actividades, mesas y catalogo

## Scope

La v1 cubre solo:

- nuevo modulo de dominio y persistencia para compras conjuntas
- nueva seccion de menu principal en privado: `Compras conjuntas`
- submenu con `Ver lista` y `Crear`
- wizard de creacion y edicion para compras conjuntas
- dos modos de compra: `shared_cost` y `per_item`
- campos configurables por compra de tipos `integer`, `single_choice` y `text`
- participacion de usuarios con estados `interested`, `confirmed`, `paid` y `delivered`
- plazos opcionales de apuntarse y confirmar
- mensajes privados a usuarios apuntados cuando el creador publique novedades o cambie el estado operativo relevante
- tests de dominio, store y flujo Telegram equivalentes a los patrones actuales del proyecto

La v1 no cubre:

- cobros reales por Telegram ni integracion con pasarelas de pago
- calculo contable avanzado con descuentos, impuestos, envio prorrateado o varias monedas
- automatismos en background para cerrar compras al vencer un plazo sin interaccion del usuario
- campos dinamicos complejos como multiseleccion, adjuntos, dependencias entre campos o formulas arbitrarias
- historial reenviado al volver a apuntarse una persona que se habia borrado antes
- exportaciones CSV, panel web o mini app

## Current Project Context

El proyecto ya tiene un patron claro para este tipo de feature:

- `src/telegram/action-menu.ts` resuelve el menu principal persistente por rol y contexto
- `src/telegram/runtime-boundary-registration.ts` registra comandos, textos y telemetria de menu
- `src/telegram/schedule-flow-support.ts` implementa un flujo privado completo con sesiones, callbacks, audit log y notificaciones
- `src/schedule/schedule-catalog.ts` concentra reglas de dominio y validaciones antes de persistir
- `src/schedule/schedule-catalog-store.ts` implementa persistencia Drizzle con logica minima
- `src/infrastructure/database/schema.ts` define las tablas de PostgreSQL usadas por el bot
- `src/telegram/deep-links.ts` y los modulos de presentacion ya generan enlaces `https://t.me/...?...` para abrir detalles concretos
- `context.runtime.bot.sendPrivateMessage(...)` ya existe como frontera de envio privado y se usa en membership y activities

La nueva capacidad debe seguir esa separacion:

- reglas de negocio en dominio
- persistencia en store
- render de mensajes y teclados en capa Telegram
- audit trail en `audit_log`

## Approaches Considered

### 1. Compras con estructura fija y campos hardcodeados por caso

Ventaja: implementacion inicial mas corta para ejemplos concretos como dados o ropa.

Inconveniente: obliga a tocar codigo cada vez que aparezca un nuevo tipo de compra o una nueva personalizacion.

### 2. Compras con esquema configurable por compra

Ventaja: una sola arquitectura cubre dados, ropa, pedidos con texto personalizado y variaciones futuras manteniendo el flujo y la persistencia estables.

Inconveniente: exige modelar campos y valores en varias tablas y anadir validaciones genericas.

### 3. Sistema avanzado con formulas y contabilidad completa desde el inicio

Ventaja: maxima potencia funcional.

Inconveniente: demasiado grande para la arquitectura actual del bot y para una primera entrega usable.

La opcion recomendada es la 2.

## Recommended Architecture

### 1. New Domain Module

Se recomienda crear un modulo nuevo paralelo a `schedule` y `catalog`.

Modulos definidos para la v1:

- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`

Responsabilidades del dominio:

- crear, editar, cerrar, archivar y cancelar compras conjuntas
- validar los modos `shared_cost` y `per_item`
- validar campos configurables y sus valores por participante
- gestionar transiciones de estado de participante
- aplicar plazos opcionales de alta y confirmacion
- calcular resumenes visibles de reparto de forma suficientemente estable para la v1

Responsabilidades del store:

- persistir compras, campos, participantes, valores y mensajes
- devolver listados y detalles listos para que la capa Telegram los formatee
- mantener la logica SQL pequena y predecible, siguiendo el patron de `schedule-catalog-store.ts`

### 2. Telegram Module Split

La capa Telegram debe seguir el mismo reparto funcional que ya usa `schedule`:

- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/i18n-group-purchases.ts`

Responsabilidades:

- abrir el menu de compras conjuntas desde texto o comando
- listar compras activas y recientes con deep links
- mostrar detalle de compra con botones inline segun rol y estado
- orquestar los wizards de crear, editar, apuntarse y publicar mensaje
- enviar notificaciones privadas sin bloquear la accion principal si algun envio falla

### 3. Main Menu Integration

Se debe anadir una nueva accion visible para socios aprobados y admins en `src/telegram/action-menu.ts`.

Propuesta:

- id: `group_purchases`
- label localizada: `Compras conjuntas`
- telemetryActionKey: `menu.group_purchases`
- seccion UX: `primary`

El menu por defecto quedaria ampliado con una nueva fila o redistribucion pequena, manteniendo el estilo actual de teclado persistente.

### 4. Permissions Model

La v1 debe usar una regla simple y coherente con el proyecto:

- cualquier usuario aprobado puede crear una compra conjunta
- el creador puede gestionar su compra conjunta
- un admin puede gestionar cualquiera
- se reserva un permiso futuro `group_purchase.manage` para override explicito

No hace falta introducir mas granularidad en esta primera version.

## Data Model

### 1. Group Purchases

Nueva tabla `group_purchases` con estos campos:

- `id`
- `title`
- `description`
- `purchaseMode`: `shared_cost | per_item`
- `lifecycleStatus`: `open | closed | archived | cancelled`
- `createdByTelegramUserId`
- `joinDeadlineAt` nullable
- `confirmDeadlineAt` nullable
- `totalPriceCents` nullable
- `unitPriceCents` nullable
- `unitLabel` nullable
- `allocationFieldKey` nullable
- `createdAt`
- `updatedAt`
- `cancelledAt` nullable

Decisiones de v1:

- no hace falta estado `draft` persistido; el borrador vive en sesion Telegram hasta guardar
- `shared_cost` usa `totalPriceCents` como importe global opcional pero recomendado
- `per_item` usa `unitPriceCents` y `unitLabel` como metadatos visibles opcionales
- `allocationFieldKey` identifica el campo `integer` que representa el peso proporcional en compras compartidas cuando aplique

### 2. Configurable Fields

Nueva tabla `group_purchase_fields`:

- `id`
- `purchaseId`
- `fieldKey`
- `label`
- `fieldType`: `integer | single_choice | text`
- `isRequired`
- `sortOrder`
- `config` jsonb
- `affectsQuantity` boolean

Contrato por tipo:

- `integer`: `config` puede incluir `min`, `max` y `defaultValue`
- `single_choice`: `config` debe incluir `options` con etiquetas visibles y un valor canonico
- `text`: `config` puede incluir `maxLength` y `placeholder` visible solo como ayuda de copia

Reglas de v1:

- solo un campo puede tener `affectsQuantity = true`
- en `per_item` ese campo debe ser `integer` y representa cuantas unidades quiere la persona
- en `shared_cost` ese campo `integer` es opcional y representa el peso proporcional; si no existe, cada participante aporta peso `1`

### 3. Participants

Nueva tabla `group_purchase_participants`:

- `purchaseId`
- `participantTelegramUserId`
- `status`: `interested | confirmed | paid | delivered | removed`
- `joinedAt`
- `updatedAt`
- `removedAt` nullable
- `confirmedAt` nullable
- `paidAt` nullable
- `deliveredAt` nullable

Debe existir clave unica por `purchaseId + participantTelegramUserId`.

Decisiones de v1:

- al apuntarse, la persona entra como `interested`
- la propia persona puede pasar a `confirmed` si la compra sigue abierta y no ha vencido el plazo de confirmacion
- `paid` y `delivered` solo los marca creador o admin
- borrarse de la compra implica `removed`, no borrado fisico

### 4. Participant Field Values

Nueva tabla `group_purchase_participant_field_values`:

- `purchaseId`
- `participantTelegramUserId`
- `fieldId`
- `value` jsonb
- `updatedAt`

Se guarda una fila por campo y participante para evitar rehacer toda la compra al editar un solo valor.

### 5. Purchase Messages

Nueva tabla `group_purchase_messages`:

- `id`
- `purchaseId`
- `authorTelegramUserId`
- `body`
- `createdAt`

La tabla se usa para trazabilidad basica y para auditar que se publico un mensaje, aunque la v1 no expone historico navegable desde Telegram.

## Domain Rules

### 1. Purchase Lifecycle

Estados globales de compra:

- `open`: acepta altas y acciones normales
- `closed`: ya no acepta nuevas altas ni nuevas confirmaciones de usuario
- `archived`: solo consulta historica
- `cancelled`: cerrada por anulacion operativa

Reglas:

- solo `open` acepta nuevos apuntados
- `closed`, `archived` y `cancelled` siguen siendo visibles desde detalle si el usuario ya participaba o si es gestor
- `cancelled` no permite cambios operativos salvo consulta

### 2. Participant Status Transitions

Reglas de transicion para usuario normal:

- `interested -> confirmed`
- cualquier estado activo `-> removed` solo como baja propia

Reglas de transicion para creador o admin:

- pueden fijar manualmente `interested`, `confirmed`, `paid` o `delivered`
- pueden marcar cualquier estado activo como `removed`
- cada cambio debe dejar trazabilidad en `audit_log`

La v1 no cubre:

- estados paralelos
- historial reversible automatico
- reglas complejas de validacion contable entre `paid` y `delivered`

### 3. Deadlines

Plazos opcionales:

- `joinDeadlineAt`
- `confirmDeadlineAt`

Reglas:

- si `joinDeadlineAt` ha vencido, nadie nuevo puede apuntarse
- si `confirmDeadlineAt` ha vencido, un participante `interested` ya no puede confirmarse por si mismo
- el creador y el admin si pueden seguir corrigiendo estados despues del plazo

La v1 no necesita un scheduler. Los plazos se aplican al procesar la interaccion.

### 4. Shared Cost Rules

Modo `shared_cost`:

- el coste global visible sale de `totalPriceCents` si se ha informado
- cada participante activo aporta un peso
- el peso sale del campo `allocationFieldKey` si existe; si no existe, el peso es `1`
- los resumenes visibles muestran el peso de cada participante y, cuando haya precio total, una estimacion proporcional de cuanto le corresponde pagar

La v1 no necesita resolver redondeo final contable perfecto. Basta con calcular una estimacion razonable para presentacion.

### 5. Per Item Rules

Modo `per_item`:

- una persona puede indicar cuantas unidades quiere mediante el campo con `affectsQuantity = true`
- si hay `unitPriceCents`, el detalle puede mostrar coste estimado por persona y total agregado
- `unitLabel` sirve para copiar mensajes mas naturales, por ejemplo `dados`, `camisetas` o `sudaderas`

La v1 no obliga a informar precio unitario para que la compra sea usable.

## Telegram UX

### 1. Menu Entry

Nueva seccion principal:

- `Compras conjuntas`

Submenu:

- `Ver lista`
- `Crear`

La seccion vive solo en chat privado y solo para usuarios aprobados.

### 2. List View

La lista debe mostrar compras activas y compras recientes relevantes con un resumen breve.

Cada linea debe incluir:

- deep link al detalle
- estado global
- resumen de participantes
- plazo visible cuando exista

Formato objetivo:

- `<a href="https://t.me/...start=group_purchase_7"><b>Pedido de dados Chessex</b></a> · Abierta · 5 interesados · 3 confirmados · cierre 30/04`

### 3. Detail View

El detalle debe incluir:

- titulo y descripcion
- modo de compra
- estado global
- plazos si existen
- resumen economico
- campos configurables activos
- resumen por estados de participantes
- acciones disponibles segun rol

Botones inline para usuario normal:

- `Apuntarme`
- `Editar mis datos`
- `Desapuntarme`
- `Confirmarme` si aplica

Botones inline para creador o admin:

- `Publicar mensaje`
- `Editar compra`
- `Gestionar participantes`
- `Cerrar compra`
- `Cancelar compra`
- `Archivar`

### 4. Create Flow

Wizard propuesto:

1. titulo
2. descripcion
3. modo de compra
4. precio total o unitario segun modo, con opcion de omitir
5. etiqueta de unidad si aplica
6. plazo de apuntarse, opcional
7. plazo de confirmarse, opcional
8. configuracion de campos
9. seleccion del campo que afecta a cantidad o peso, si aplica
10. confirmacion final

Para configuracion de campos, la v1 debe permitir crear varios campos uno a uno desde teclado guiado:

- `Anadir numero`
- `Anadir opcion`
- `Anadir texto`
- `Seguir`

No hace falta ofrecer edicion compleja intra-wizard mas alla de borrar el ultimo o revisar resumen antes de guardar.

### 5. Join Flow

Cuando una persona se apunta:

1. se crea o reactiva su participacion como `interested`
2. el bot solicita los campos configurables en orden
3. al finalizar, muestra un resumen de lo que ha pedido
4. el bot envia un mensaje privado de confirmacion de alta

Si la persona ya estaba `removed`, se reactiva su registro en lugar de crear uno nuevo.

### 6. Participant Management Flow

El creador y el admin deben poder abrir una vista de participantes desde el detalle:

- lista de participantes con estado actual
- click en cada participante para cambiar estado
- acciones rapidas `Confirmado`, `Pagado`, `Entregado`, `Quitar`

No hace falta paginacion en la v1 salvo que el numero crezca mucho. Una lista simple es suficiente para el volumen esperado del club.

### 7. Publish Message Flow

El creador o admin debe poder escribir un mensaje libre asociado a la compra.

Formato de envio obligatorio:

`Este es un mensaje sobre la compra conjunta <a href="...">[nombre]</a>, enviado por [usuario]:`

`[linea en blanco]`

`[mensaje]`

Decisiones de v1:

- el nombre de la compra es clickable mediante deep link
- el nombre del usuario remitente se muestra como texto legible normalizado
- el mensaje se envia solo a participantes no eliminados

## Data Flow

### Flow 1: Create Per Item Purchase

1. Una persona aprobada abre `Compras conjuntas > Crear`.
2. Introduce titulo y descripcion.
3. Elige `per_item`.
4. Introduce precio unitario y etiqueta `dados` o decide omitir precio.
5. Define un campo `integer` llamado `Cantidad` marcado como `affectsQuantity`.
6. Anade un campo `single_choice` llamado `Color`.
7. Confirma el resumen.
8. Se persisten compra y campos.
9. El bot muestra el detalle con acciones de gestion.

### Flow 2: Join Purchase With Custom Fields

1. Una persona abre el detalle desde la lista o un deep link.
2. Pulsa `Apuntarme`.
3. El bot pregunta los campos configurables en orden.
4. La persona responde `6` para `Cantidad` y `Azul` para `Color`.
5. El sistema guarda o actualiza sus valores.
6. La participacion queda en `interested`.
7. El bot devuelve un resumen y el estado actual.

### Flow 3: Self Confirmation Before Deadline

1. La compra sigue `open` y el plazo de confirmacion no ha vencido.
2. La persona ya esta en `interested`.
3. Pulsa `Confirmarme`.
4. El dominio valida el plazo.
5. Su estado pasa a `confirmed`.
6. El bot confirma el cambio por privado.

### Flow 4: Creator Publishes Update

1. El creador abre el detalle.
2. Pulsa `Publicar mensaje`.
3. Escribe una actualizacion, por ejemplo sobre pedido o entrega.
4. El sistema persiste el mensaje en `group_purchase_messages`.
5. El bot envia el texto formateado a todas las personas activas de la compra.
6. Si un envio falla, se ignora ese fallo y la publicacion sigue considerandose realizada.

### Flow 5: Mark Participant As Paid And Delivered

1. El creador abre `Gestionar participantes`.
2. Selecciona a una persona.
3. Marca `Pagado`.
4. Mas tarde marca `Entregado`.
5. Cada cambio queda auditado y envia una notificacion privada corta al usuario afectado.

## Error Handling

- Si el usuario intenta apuntarse a una compra `closed`, `archived` o `cancelled`, el bot debe rechazarlo con un mensaje claro.
- Si ha vencido `joinDeadlineAt`, el alta debe rechazarse aunque el boton viejo siga visible en un callback antiguo.
- Si ha vencido `confirmDeadlineAt`, la auto-confirmacion debe rechazarse aunque exista callback antiguo.
- Si un valor de campo no cumple el tipo o las restricciones de `config`, el flujo debe repetir ese paso sin corromper la sesion.
- Si un `single_choice` recibe una opcion no valida, el bot debe volver a mostrar el teclado de opciones.
- Si la compra pierde o cambia un campo mientras un usuario esta en mitad del flujo, el sistema debe reiniciar de forma segura la captura de datos en lugar de guardar una mezcla inconsistente.
- Si enviar un mensaje privado a un participante falla, el error no debe revertir la accion principal de publicacion o cambio de estado.
- Si un usuario intenta editar o cancelar una compra ajena sin permisos, el bot debe responder con `accessDeniedGeneric` o un mensaje localizado equivalente.

## Implementation Notes

### 1. Schema And Migration

- ampliar `src/infrastructure/database/schema.ts` con las cuatro tablas nuevas principales y sus indices
- crear la migracion Drizzle correspondiente
- indexar por `lifecycleStatus`, `createdByTelegramUserId`, `joinDeadlineAt` y `confirmDeadlineAt` donde tenga sentido para listados

### 2. Domain Contracts

El dominio debe exponer contratos pequenos y composables, siguiendo el estilo de `schedule-catalog.ts`:

- `createGroupPurchase`
- `updateGroupPurchase`
- `listGroupPurchases`
- `getGroupPurchaseDetail`
- `joinGroupPurchase`
- `updateGroupPurchaseParticipantValues`
- `changeGroupPurchaseParticipantStatus`
- `publishGroupPurchaseMessage`

No hace falta introducir una capa de servicios adicional si el dominio y el store quedan bien delimitados.

### 3. Telegram Routing

Se debe registrar el nuevo flujo en `src/telegram/runtime-boundary-registration.ts` siguiendo el patron existente de texto, comandos y callbacks.

Comandos de v1:

- `/group_purchases`
- `/group_purchase_create`

Textos equivalentes desde teclado persistente y submenu.

### 4. Deep Links

Se deben usar deep links de detalle consistentes:

- `group_purchase_<id>`

El detalle abierto desde deep link debe renderizar los mismos botones y restricciones que la navegacion normal.

### 5. Audit Trail

Eventos recomendados en `audit_log`:

- `group_purchase.created`
- `group_purchase.updated`
- `group_purchase.closed`
- `group_purchase.cancelled`
- `group_purchase.archived`
- `group_purchase.participant_joined`
- `group_purchase.participant_updated`
- `group_purchase.participant_status_changed`
- `group_purchase.message_published`

No hace falta una tabla de auditoria dedicada en la v1.

## Testing

La feature debe cubrir tres niveles, siguiendo el estilo ya usado en `schedule` y `catalog`.

### 1. Domain Tests

Cubrir:

- creacion valida en `shared_cost` y `per_item`
- rechazo de configuraciones invalidas de campos
- aplicacion correcta de plazos de alta y confirmacion
- transiciones validas e invalidas de estado de participante
- calculo basico de peso proporcional y cantidad por usuario

### 2. Store Tests

Cubrir:

- persistencia de compra y campos configurables
- upsert de participante sin duplicados
- reactivacion de participante previamente `removed`
- persistencia de valores por campo
- listados por estado y detalle con joins correctos

### 3. Telegram Flow Tests

Cubrir:

- apertura del menu desde el teclado principal
- wizard de creacion completo
- lista con deep links visibles
- alta de participante y edicion de sus datos
- auto-confirmacion dentro y fuera de plazo
- publicacion de mensaje con formato correcto
- gestion de estados por creador o admin
- rechazo de acciones sin permisos

No hace falta test end-to-end real contra Telegram. Debe bastar con el patron de stubs y repositorios fake ya existente en `src/telegram/*.test.ts`.

## Acceptance Criteria

- el menu principal muestra `Compras conjuntas` para socios aprobados y admins
- existe un submenu privado con `Ver lista` y `Crear`
- una persona aprobada puede crear una compra conjunta con titulo, descripcion y modo
- la compra puede definirse como `shared_cost` o `per_item`
- una compra puede definir campos configurables `integer`, `single_choice` y `text`
- una persona puede apuntarse y rellenar sus campos configurables
- los participantes pueden quedar en `interested`, `confirmed`, `paid` o `delivered`
- existen plazos opcionales de alta y confirmacion aplicados al interactuar
- el creador puede publicar un mensaje que llega solo a participantes activos con el formato acordado
- el detalle y la lista se pueden abrir mediante deep links
- la feature queda cubierta por tests de dominio, store y flujo Telegram

## Fixed Decisions For V1

Para evitar ambiguedades, esta especificacion fija ademas estas decisiones:

- `Eliminar` en la interfaz se implementa como cancelacion o archivado logico, no como borrado fisico
- el alta inicial siempre deja el estado en `interested`
- `confirmed` puede marcarlo el propio usuario si no ha vencido el plazo
- `paid` y `delivered` los marca creador o admin
- la seccion solo existe en chat privado
- los mensajes publicados se envian solo a participantes no eliminados
- no se reenvia historico al reapuntarse una persona
