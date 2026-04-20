# Group Purchases Implementation Plan

## Goal

Implementar `Compras conjuntas` como una nueva capacidad del bot, manteniendo la separacion actual entre dominio, persistencia y capa Telegram, y entregando la feature en slices que dejen el sistema siempre ejecutable.

## Source Documents

- `docs/superpowers/specs/2026-04-20-group-purchases-design.md`
- `src/telegram/action-menu.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/schedule-flow-support.ts`
- `src/schedule/schedule-catalog.ts`
- `src/schedule/schedule-catalog-store.ts`
- `src/infrastructure/database/schema.ts`

## Planning Principles

- cada fase debe dejar el bot compilando y con comportamiento coherente
- los cambios de dominio deben entrar junto a su migracion y tests de store
- la capa Telegram no debe mezclar validacion de negocio que pertenezca al dominio
- los callbacks antiguos o enlaces stale deben fallar de forma segura en servidor
- las notificaciones privadas nunca deben bloquear la accion principal

## Proposed Execution Order

### Phase 1. Domain and schema foundation

Scope:

- introducir el modelo persistente de compras conjuntas
- dejar definido el contrato de dominio y store
- cubrir reglas basicas sin tocar todavia el menu principal ni los flujos Telegram completos

Files to add or update:

- `src/infrastructure/database/schema.ts`
- `drizzle/<new_migration>.sql`
- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `src/group-purchases/group-purchase-catalog.test.ts`
- `src/group-purchases/group-purchase-catalog-store.test.ts`

Implementation direction:

- anadir tablas `group_purchases`, `group_purchase_fields`, `group_purchase_participants`, `group_purchase_participant_field_values` y `group_purchase_messages`
- definir tipos de dominio para compra, campo configurable, participante y mensaje
- definir contratos principales del repositorio
- implementar validaciones base de modos `shared_cost` y `per_item`
- implementar validaciones de tipos de campo `integer`, `single_choice` y `text`
- implementar reglas de plazos y de transicion de estados de participante

Acceptance criteria:

- el dominio puede crear y actualizar compras validas en ambos modos
- el store persiste y recupera compras con sus campos y participantes
- existen tests de dominio para reglas invalidas y validas
- existen tests de store para joins principales y upsert de participantes

### Phase 2. Read model and Telegram entry points

Scope:

- conectar la nueva seccion al menu principal
- permitir abrir el submenu y consultar lista y detalle
- dejar listos deep links y callbacks base sin incluir aun los wizards de escritura completos

Files to add or update:

- `src/telegram/action-menu.ts`
- `src/telegram/i18n-common.ts`
- `src/telegram/i18n.ts`
- `src/telegram/i18n-group-purchases.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/group-purchase-flow.ts`
- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/action-menu.test.ts`
- `src/telegram/runtime-boundary.test.ts`
- `src/telegram/group-purchase-flow.test.ts`

Implementation direction:

- anadir accion `group_purchases` al menu principal con `menu.group_purchases`
- crear submenu privado con `Ver lista` y `Crear`
- implementar list view con resumen de estado, participantes y plazo
- implementar detail view con deep link `group_purchase_<id>`
- implementar botones inline segun rol, aunque algunos queden todavia apuntando a flows no completados
- registrar texto, comando y start payload para abrir lista o detalle

Acceptance criteria:

- un socio aprobado ve `Compras conjuntas` en el menu principal
- el submenu se abre desde teclado y desde comando
- la lista muestra compras con enlaces clicables
- el detalle se abre desde deep link y respeta permisos basicos
- la telemetria de menu recoge `menu.group_purchases`

### Phase 3. Create and edit purchase flow

Scope:

- implementar el wizard de creacion completo
- implementar la edicion del creador o admin sobre metadatos y campos configurables

Files to add or update:

- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/i18n-group-purchases.ts`
- `src/telegram/conversation-session.ts` solo si hiciera falta algun helper reutilizable
- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `src/telegram/group-purchase-flow.test.ts`

Implementation direction:

- crear flujo por pasos para titulo, descripcion, modo, precio, unidad, plazos y campos configurables
- permitir definir varios campos uno a uno
- permitir marcar un unico campo como `affectsQuantity`
- mostrar resumen de borrador antes de guardar
- implementar flujo de edicion del creador o admin sobre compra ya persistida
- evitar una UI excesivamente sofisticada en v1: cambios pequenos y seguros, siguiendo el patron de `schedule`

Acceptance criteria:

- una persona aprobada puede crear una compra valida de principio a fin
- la compra puede quedar en `shared_cost` o `per_item`
- la compra puede persistir campos configurables de los tres tipos permitidos
- creador y admin pueden editar la compra sin corromper datos ya existentes

### Phase 4. Participant signup, self-edit, and self-confirmation

Scope:

- permitir que usuarios se apunten
- permitir editar sus propios datos mientras sigan activos
- permitir auto-confirmarse dentro del plazo

Files to add or update:

- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/group-purchase-flow.test.ts`
- `src/group-purchases/group-purchase-catalog.test.ts`

Implementation direction:

- implementar `joinGroupPurchase` con reactivacion de participante `removed`
- capturar los valores de campos en orden y con validacion por tipo
- permitir `Editar mis datos` para reabrir solo la captura de campos del participante actual
- implementar `Desapuntarme` como transicion a `removed`
- implementar `Confirmarme` sujeto a `confirmDeadlineAt`
- enviar confirmacion privada corta tras alta y tras auto-confirmacion

Acceptance criteria:

- un usuario puede apuntarse a una compra abierta
- si la compra tiene campos, el bot los solicita y guarda
- un usuario activo puede editar sus propios valores
- un usuario puede desapuntarse sin borrado fisico
- `Confirmarme` funciona solo cuando el plazo lo permite

### Phase 5. Creator management and status operations

Scope:

- permitir al creador y admin gestionar participantes
- permitir cerrar, cancelar y archivar compras

Files to add or update:

- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/telegram/group-purchase-keyboards.ts`
- `src/telegram/group-purchase-flow.test.ts`
- `src/group-purchases/group-purchase-catalog.test.ts`

Implementation direction:

- implementar vista de participantes desde el detalle
- permitir fijar manualmente estados `interested`, `confirmed`, `paid`, `delivered` o `removed`
- permitir cerrar compra para bloquear nuevas altas y nuevas auto-confirmaciones
- permitir cancelar y archivar con semantica de borrado logico
- asegurar que los permisos son: creador, admin y futuro override si se activa despues

Acceptance criteria:

- creador y admin pueden gestionar estados de participantes desde el detalle
- el usuario normal no puede cambiar estados ajenos
- una compra `closed`, `archived` o `cancelled` bloquea las acciones que no correspondan
- la lista y el detalle reflejan el estado global actualizado

### Phase 6. Broadcast messages, audit trail, and notifications

Scope:

- publicar mensajes privados a participantes activos
- dejar trazabilidad en `audit_log`
- completar notificaciones relevantes de estado

Files to add or update:

- `src/telegram/group-purchase-flow.ts`
- `src/telegram/group-purchase-presentation.ts`
- `src/group-purchases/group-purchase-catalog.ts`
- `src/group-purchases/group-purchase-catalog-store.ts`
- `src/audit/audit-log.ts` solo si hace falta helper nuevo
- `src/telegram/group-purchase-flow.test.ts`

Implementation direction:

- implementar `Publicar mensaje` con persistencia en `group_purchase_messages`
- formatear el mensaje exactamente como fija el spec, con nombre clickable de compra
- enviar el mensaje solo a participantes no eliminados
- anadir eventos `group_purchase.*` a `audit_log`
- enviar notificaciones privadas cortas a usuarios afectados cuando creador o admin cambien su estado
- envolver envios privados en manejo de errores no bloqueante

Acceptance criteria:

- un mensaje publicado llega solo a participantes activos
- un fallo de envio a un usuario no rompe la publicacion global
- los eventos principales dejan rastro en `audit_log`
- el formato del mensaje coincide con el acordado en el spec

### Phase 7. Verification and polish

Scope:

- cerrar huecos de i18n, test coverage y consistencia de UX
- dejar la feature lista para uso real en el bot

Files to add or update:

- `src/telegram/i18n-group-purchases.ts`
- `src/telegram/i18n.ts`
- `src/telegram/group-purchase-flow.test.ts`
- cualquier test puntual adicional en runtime o action menu

Implementation direction:

- revisar textos en `ca`, `es` y `en`
- revisar que la feature se comporte bien con callbacks antiguos y deep links stale
- completar tests de casos borde y permisos
- verificar build, typecheck y tests relevantes

Acceptance criteria:

- la feature compila y pasa tests relevantes
- la navegacion principal y los wizards no rompen el menu persistente
- los errores y estados vacios son legibles
- no quedan placeholders ni ramas muertas de v1

## Recommended Work Batches

### Batch A

- Phase 1

Objetivo:

- dejar listo el nucleo de datos y reglas sin depender todavia del routing Telegram

### Batch B

- Phase 2

Objetivo:

- poner la feature visible y navegable en modo lectura cuanto antes

### Batch C

- Phase 3
- Phase 4

Objetivo:

- completar el ciclo principal de crear compra y apuntarse

### Batch D

- Phase 5
- Phase 6

Objetivo:

- completar la operativa real del creador y las comunicaciones a participantes

### Batch E

- Phase 7

Objetivo:

- endurecer la entrega final y preparar merge seguro

## Validation Strategy After Each Batch

- ejecutar los tests focalizados del dominio o flujo tocado
- ejecutar `npm run build`
- ejecutar `npm run typecheck` si el repo lo tiene disponible
- si se toca routing o menus, ejecutar tambien los tests de `action-menu` y `runtime-boundary`
- si una fase cambia persistencia, revisar que el store tenga tests propios antes de cerrar el batch

## Risks To Watch During Implementation

### 1. Wizard complexity growth

Riesgo:

- el flujo de creacion puede crecer demasiado si se intenta soportar demasiadas variantes de campos en una sola pasada

Mitigacion:

- limitar la v1 a `integer`, `single_choice` y `text`
- preferir teclados y pasos pequenos, no un editor generalista complejo

### 2. Inconsistent participant data after field edits

Riesgo:

- si el creador modifica campos despues de que usuarios ya se hayan apuntado, pueden quedar valores incompatibles

Mitigacion:

- en v1, permitir editar metadatos y campos con criterio conservador
- bloquear o reiniciar capturas en curso si cambia el esquema
- si un campo deja de existir, no intentar reinterpretar automatico los datos viejos

### 3. Menu crowding

Riesgo:

- el menu principal ya tiene varias acciones y puede degradarse la UX del teclado persistente

Mitigacion:

- tocar `action-menu.ts` con el cambio minimo posible
- mantener la agrupacion `primary` coherente
- ampliar tests de menu para validar el layout final

### 4. Silent notification failures

Riesgo:

- los mensajes privados pueden fallar y ocultar problemas operativos si se silencian demasiado

Mitigacion:

- no bloquear la accion principal
- pero dejar audit trail y, si ya existe patron de logging, registrar el fallo de forma discreta

## Exit Criteria

Este plan se considera completado cuando:

- la nueva seccion `Compras conjuntas` esta integrada en el menu principal privado
- una persona aprobada puede crear una compra y apuntarse a ella desde Telegram
- el creador puede gestionar estados y publicar mensajes a participantes activos
- la feature deja trazabilidad en `audit_log`
- la persistencia queda cubierta por migracion y tests
- los flujos clave quedan cubiertos por tests y el bot sigue compilando sin regresiones visibles
