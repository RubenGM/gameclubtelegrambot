# Gestión de partidas de rol

## Objetivo

Añadir una feature privada `Rol` para organizar partidas de rol del club, tanto
campañas como one-shots, desde Telegram.

La feature debe resolver la organización práctica: ficha de partida, jugadores,
personajes básicos, sesiones, material y handouts. No intenta ser un VTT ni un
gestor completo de fichas. Debe apoyarse en las piezas maduras del bot:

- Agenda para sesiones reales, asistencia, mesas y recordatorios.
- Storage como infraestructura interna de archivos.
- Deep links y navegación inline para abrir detalles concretos.
- Menús privados con estado cancelable y listas paginadas.

## Alcance de la primera versión

Incluido:

- Botón privado `Rol` para socios aprobados.
- Crear partidas de tipo `campaña` o `one-shot`.
- Ficha de partida con título, sistema, descripción, plazas, visibilidad, modo
  de entrada, estado, máster principal y coorganizadores.
- Jugadores por partida con estado, nombre de personaje y nota corta.
- Partidas cerradas por invitación y partidas abiertas con solicitud de plaza.
- Autoaceptación configurable hasta llenar plazas o revisión por máster/admin.
- Visibilidad configurable: privada, visible para socios o pública.
- Partidas públicas configurables para aceptar sólo socios o también usuarios
  externos de Telegram sin convertirlos en socios.
- Sesiones reales creadas como eventos de Agenda vinculados a la partida.
- One-shots con una sesión inicial de día y hora.
- Campañas con programación manual asistida o recurrencia automática.
- Ventana móvil configurable de próximas sesiones automáticas.
- Autoapuntado configurable de jugadores confirmados a sesiones creadas desde
  la partida.
- Material vinculado a partida, subido desde `Rol` y guardado en infraestructura
  interna de Storage.
- Handouts con visibilidad `jugadores` o `sólo máster`.
- Acciones para enviar handouts a jugadores: enviar sólo esta vez, enviar y
  revelar, revelar sin enviar.
- Ocultación estricta de handouts desde Storage normal.
- Permisos diferenciados para socio, externo, jugador, máster, coorganizador y
  admin.

Fuera de la primera versión:

- Ayuda de IA para dirigir, resumir o generar contenido.
- Herramientas de sesión en curso como PNJ, pistas, botín o reglas dudosas.
- Edición web/admin completa de partidas.
- Gestión rica de fichas de personaje.
- Encuestas de disponibilidad.
- Integración avanzada con LFG más allá de dejar el modelo preparado para una
  iteración posterior.

## Decisiones

- `Rol` es una feature propia de Telegram, no una subpantalla de Agenda ni LFG.
- Las sesiones jugables son eventos de Agenda; no hay calendario paralelo.
- Los archivos de handouts usan infraestructura de Storage, pero no son visibles
  desde `/storage`, búsqueda de Storage, panel normal de Storage ni TUI normal.
- El acceso a handouts se decide desde `Rol`, por relación con la partida, no
  por permisos genéricos de Storage.
- Los deep links de handouts son de `Rol`, no `storage_entry_<id>`.
- Cualquier socio aprobado puede crear partida y queda como máster principal.
- La partida puede tener coorganizadores con permisos operativos, sin poder
  cambiar el máster principal ni cerrar/borrar la partida.
- Los admins pueden intervenir en cualquier partida.
- Los usuarios externos sólo pueden interactuar con partidas públicas que
  aceptan externos y sólo dentro de esa partida/sesión.
- Las reglas de Agenda existentes para conflicto de mesa/capacidad se respetan:
  avisar y permitir continuar cuando el flujo actual lo permite.

## Reglas de UX Telegram

Toda la feature debe seguir los patrones actuales del bot:

- Todo flujo guiado muestra `Cancelar`.
- `Cancelar` limpia la sesión activa y devuelve al bot a un estado normal, con
  teclado raíz o contexto normal.
- Las acciones importantes usan botones resaltados según el sistema existente:
  crear, confirmar, guardar, programar, compartir, revelar, aceptar plaza.
- Las acciones destructivas o de cierre se muestran diferenciadas.
- Las listas largas son paginadas con el estilo existente, incluyendo pie tipo
  `Mostrando X-Y de Z. Página A/B`.
- Cuando sea posible, los listados usan enlaces inline/deep links para abrir
  partidas, sesiones, materiales o detalles concretos.
- Los botones de teclado se reservan para operaciones; los enlaces inline se
  prefieren para navegación cuando el mensaje lo permita.
- Los mensajes largos deben evitar duplicar contenido que ya tenga detalle por
  deep link.

## Menú principal de `Rol`

El menú privado inicial de `Rol` muestra:

- `Mis partidas`
- `Partidas visibles`
- `Crear partida`
- `Solicitudes`, sólo cuando el usuario tenga solicitudes pendientes como
  máster, coorganizador o admin
- `Inicio`
- `Ayuda`

`Mis partidas` lista partidas donde el usuario sea máster principal,
coorganizador o jugador confirmado.

`Partidas visibles` lista partidas visibles para el usuario:

- partidas de socio visibles para socios aprobados
- partidas públicas accesibles por configuración
- partidas privadas sólo si el usuario ya pertenece a ellas o es admin

Cada fila debe mostrar, de forma compacta:

- título enlazado al detalle
- tipo: campaña u one-shot
- sistema
- estado
- plazas ocupadas/totales
- próxima sesión, si existe

## Detalle de partida

El detalle de partida es el centro operativo.

Debe mostrar:

- título y sistema
- tipo y estado
- descripción resumida
- visibilidad y modo de entrada
- máster principal y coorganizadores
- plazas y jugadores confirmados
- próxima sesión
- material visible para el usuario
- acciones disponibles según permisos

Acciones posibles:

- Solicitar plaza
- Aceptar/Rechazar solicitudes
- Gestionar jugadores
- Editar personaje propio
- Programar siguiente sesión
- Configurar recurrencia
- Ver sesiones
- Ver material
- Subir material
- Compartir handout
- Editar partida
- Cerrar partida

Las acciones se filtran por permisos y estado.

## Modelo de permisos

Socio aprobado:

- puede abrir `Rol`
- puede crear partidas
- puede ver partidas visibles para socios
- puede solicitar plaza o apuntarse si la partida lo permite
- puede ver y operar sus propias partidas según su rol dentro de cada una

Máster principal:

- control completo de su partida
- puede editar configuración completa
- puede gestionar jugadores, solicitudes, sesiones y material
- puede añadir o quitar coorganizadores
- puede cerrar/cancelar la partida

Coorganizador:

- puede programar sesiones
- puede configurar o ejecutar la programación operativa si la partida lo permite
- puede gestionar material y handouts
- puede aceptar/rechazar solicitudes
- no puede cambiar el máster principal
- no puede cerrar, borrar o archivar definitivamente la partida

Jugador confirmado:

- puede ver la ficha de la partida
- puede ver sesiones
- puede ver material para jugadores
- puede editar su personaje básico y nota corta propia si se permite
- puede programar sesión manual en campañas cuando la partida lo permite

Usuario externo de Telegram:

- sólo entra por deep links públicos
- sólo puede ver/solicitar/apuntarse en partidas públicas configuradas para
  externos
- no se convierte automáticamente en socio
- no obtiene acceso a Storage general
- sólo puede recibir/ver material revelado para jugadores de su partida

Admin:

- puede gestionar cualquier partida
- puede intervenir en solicitudes, jugadores, sesiones y material
- puede cerrar partidas problemáticas

## Modelo de datos

### `role_games`

Tabla principal de partidas.

Campos previstos:

- `id`
- `type`: `campaign` o `one_shot`
- `status`: `draft`, `active`, `paused`, `closed`, `cancelled`
- `title`
- `system`
- `description`
- `visibility`: `private`, `members`, `public`
- `public_join_policy`: `members_only` o `members_and_external`
- `entry_mode`: `invite_only` o `request`
- `acceptance_mode`: `manual_review` o `auto_until_full`
- `capacity`
- `primary_gm_telegram_user_id`
- `default_duration_minutes`
- `default_table_id`
- `default_attendance_mode`
- `default_is_public_schedule_event`
- `auto_add_confirmed_players`
- `allow_player_manual_scheduling`
- `scheduling_mode`: `manual`, `recurring`
- `recurrence_rule`
- `recurrence_window_count`
- `created_by_telegram_user_id`
- `created_at`
- `updated_at`
- `closed_at`

### `role_game_members`

Relación entre usuarios y partida.

Campos previstos:

- `id`
- `role_game_id`
- `telegram_user_id`
- `role`: `primary_gm`, `coorganizer`, `player`
- `status`: `invited`, `requested`, `confirmed`, `waitlisted`, `left`,
  `removed`, `rejected`
- `character_name`
- `player_note`
- `created_at`
- `updated_at`

Debe haber restricciones para evitar más de un `primary_gm` activo por partida y
para evitar duplicados activos de usuario/partida.

### `role_game_sessions`

Vínculo entre partida y eventos de Agenda.

Campos previstos:

- `id`
- `role_game_id`
- `schedule_event_id`
- `source`: `one_shot_initial`, `manual`, `recurring`
- `generated_for_starts_at`
- `created_by_telegram_user_id`
- `created_at`

### `role_game_materials`

Metadatos de material/handout de partida.

Campos previstos:

- `id`
- `role_game_id`
- `internal_storage_entry_id`
- `title`
- `description`
- `visibility`: `players` o `gm_only`
- `delivery_state`: `not_sent`, `sent`, `revealed`
- `uploaded_by_telegram_user_id`
- `created_at`
- `updated_at`
- `revealed_at`

`internal_storage_entry_id` apunta a una entrada de Storage marcada como interna
para `Rol`. Esa entrada no aparece en superficies normales de Storage.

### `role_game_material_deliveries`

Historial de entregas de handouts.

Campos previstos:

- `id`
- `role_game_material_id`
- `recipient_telegram_user_id`
- `sent_by_telegram_user_id`
- `delivery_mode`: `send_only`, `send_and_reveal`, `reveal_only`
- `status`: `sent`, `failed`
- `error_code`
- `sent_at`

## Creación de partida

El flujo de creación se inicia desde `Rol` -> `Crear partida`.

Pasos principales:

1. Elegir tipo: campaña u one-shot.
2. Título.
3. Sistema.
4. Descripción.
5. Plazas.
6. Visibilidad.
7. Si es pública, elegir si acepta sólo socios o también externos.
8. Modo de entrada: invitación o solicitud.
9. Modo de aceptación: revisión o autoaceptar hasta llenar.
10. Duración por defecto.
11. Mesa por defecto, permitiendo dejarla sin fijar.
12. Autoapuntar jugadores confirmados a sesiones: sí/no.
13. Configuración de sesiones:
    - one-shot: día/hora de la sesión inicial.
    - campaña: manual asistida o automática recurrente.
14. Resumen final.
15. Confirmar.

El resumen final debe mostrar de forma explícita:

- quién será el máster principal
- visibilidad
- si acepta externos
- plazas
- modo de entrada
- política de aceptación
- comportamiento de sesiones
- comportamiento de autoapuntado

Cancelar en cualquier paso vuelve al estado normal.

## Sesiones y Agenda

Todas las sesiones reales son eventos de Agenda.

### One-shots

Al crear una one-shot:

- se pide día y hora
- se crea una partida de tipo `one_shot`
- se crea un evento de Agenda vinculado
- se crea una fila en `role_game_sessions`

La visibilidad pública de la sesión deriva de la partida, pero puede validarse
con las reglas de Agenda: una actividad pública debe ser abierta.

### Campañas manuales

Una campaña con `scheduling_mode = manual` no genera sesiones sola.

Desde el detalle, usuarios autorizados pueden pulsar `Programar siguiente sesión`.
Autorizados siempre:

- máster principal
- coorganizadores
- admins

Autorizados cuando `allow_player_manual_scheduling = true`:

- jugadores confirmados

El flujo pide sólo los datos que no están fijados por la partida:

- día
- hora
- mesa, si la partida no tiene mesa por defecto

El bot precarga:

- título de actividad
- descripción
- duración
- capacidad
- mesa por defecto
- modo abierto/cerrado
- visibilidad pública si aplica
- detalles vinculados a la partida

### Campañas recurrentes

Una campaña recurrente guarda una regla como:

- cada jueves a las 18:00
- cada 2 miércoles a las 18:30
- cada domingo a una hora concreta

La primera versión modela reglas semanales simples:

- intervalo en semanas
- día de la semana
- hora local
- duración por defecto

La partida guarda `recurrence_window_count`, por ejemplo 1, 2, 3 o 4 sesiones
futuras. Un job o paso de mantenimiento crea sesiones futuras hasta mantener esa
ventana.

Reglas:

- no duplicar sesiones ya creadas para la misma partida y fecha/hora
- no crear sesiones para partidas cerradas, canceladas o pausadas
- si una sesión futura se cancela manualmente, no debe recrearse sin una marca
  explícita o cambio de regla
- al cambiar la regla, el bot debe explicar qué pasará con sesiones futuras ya
  creadas y pedir confirmación si va a cancelarlas o dejarlas desalineadas

### Autoapuntado

Si `auto_add_confirmed_players` está activo:

- al crear una sesión desde `Rol`, se añaden como participantes de Agenda los
  jugadores confirmados
- si hay más jugadores que plazas disponibles, el bot avisa antes de confirmar
  la sesión
- externos confirmados en una partida pública también pueden añadirse a la
  sesión de esa partida

Si está desactivado:

- la sesión se crea y cada jugador se apunta como en cualquier actividad

Cancelar una sesión de Agenda no borra la partida. Cerrar una partida no borra
sesiones pasadas y debe pedir confirmación antes de cancelar futuras.

## Jugadores y solicitudes

Partidas cerradas:

- máster/admin/coorganizador invitan o añaden jugadores
- el jugador puede quedar `invited` o directamente `confirmed`, según el flujo
  elegido

Partidas abiertas con solicitud:

- usuarios elegibles ven `Solicitar plaza`
- si `acceptance_mode = auto_until_full`, pasan a `confirmed` mientras haya
  plazas
- si no hay plazas, pasan a `waitlisted` o reciben aviso según configuración
- si `acceptance_mode = manual_review`, pasan a `requested`
- máster/coorganizador/admin ve solicitudes pendientes y puede aceptar o
  rechazar

Al aceptar:

- si hay plazas, el jugador pasa a `confirmed`
- si no hay plazas, el bot propone lista de espera o rechazo

Cada jugador confirmado puede tener:

- nombre de personaje
- nota corta

El MVP no gestiona ficha completa.

## Material y handouts

El material se sube desde la ficha de partida.

Flujo:

1. Máster/coorganizador/admin pulsa `Subir material`.
2. El bot inicia un flujo privado cancelable.
3. El usuario envía documento, imagen, vídeo u otro adjunto soportado por
   Storage.
4. El bot pide nombre/descripción si no puede inferirlos.
5. El usuario elige visibilidad:
   - `Jugadores`
   - `Sólo máster`
6. El bot guarda el adjunto usando infraestructura interna de Storage.
7. El bot crea `role_game_materials`.
8. El detalle de partida muestra el material según permisos.

### Ocultación desde Storage

Los handouts no deben ser visibles desde Storage normal.

Requisitos:

- no aparecer en `/storage`
- no aparecer en búsqueda de Storage
- no aparecer en listados por categoría o tag
- no aparecer en panel web normal de Storage
- no aparecer en TUI normal de Storage
- no usar deep links `storage_entry_<id>` en mensajes a usuarios finales

Debe existir una marca interna u otra barrera equivalente que permita usar la
infraestructura de Storage sin exponer el contenido. Si se usa una categoría
interna oculta para mantenimiento técnico, su contenido no debe ser navegable
desde superficies de usuario.

La autorización final para ver un handout vive en `Rol`:

- `gm_only`: máster principal, coorganizadores y admins
- `players`: jugadores confirmados, máster principal, coorganizadores y admins
- externos confirmados: sólo materiales `players` de su partida pública

### Compartir handouts

Desde un material `Sólo máster`, usuarios autorizados pueden:

- `Enviar sólo esta vez`
- `Enviar y revelar`
- `Revelar sin enviar`

`Enviar sólo esta vez`:

- envía el archivo y descripción por privado a jugadores confirmados
- mantiene `visibility = gm_only`
- registra entregas

`Enviar y revelar`:

- envía el archivo y descripción por privado a jugadores confirmados
- cambia `visibility = players`
- marca `delivery_state = revealed`
- registra entregas

`Revelar sin enviar`:

- cambia `visibility = players`
- no envía privados
- registra acción de revelado

Entrega:

- best-effort por jugador
- si un envío falla, no revierte los demás
- el bot muestra resumen al máster: enviados, fallidos y motivo simple
- los fallos se registran como warning estructurado

## Deep links

Nuevos payloads previstos:

- `role_game_<id>`
- `role_session_<id>`
- `role_material_<id>`

Los deep links de material pasan siempre por handlers de `Rol`. No se exponen
los IDs internos de Storage como navegación pública.

## Integración con `/news` y LFG

La primera versión no necesita publicar automáticamente partidas en `/news` ni
crear anuncios LFG.

El modelo debe dejar una salida natural para futuro:

- una partida abierta podría publicar una llamada a jugadores
- una one-shot pública podría alimentar una categoría de noticias futura
- LFG podría enlazar a partidas abiertas

No se implementa en la v1 para mantener el alcance centrado en organización.

## Internacionalización

La feature debe añadir textos en los idiomas existentes del bot.

Las etiquetas visibles deben respetar el estilo actual:

- `Rol`
- `Campaña`
- `One-shot`
- `Máster`
- `Coorganizador`
- `Jugadores`
- `Sólo máster`
- `Enviar sólo esta vez`
- `Enviar y revelar`
- `Programar siguiente sesión`
- `Solicitar plaza`
- `Aceptar solicitud`
- `Rechazar solicitud`

Los textos largos deben vivir en un módulo i18n propio de la feature, no como
literales dispersos.

## Errores y casos límite

Conflictos de Agenda:

- usar la lógica actual de advertencia
- permitir continuar si Agenda lo permite

Recurrencia:

- no duplicar sesiones
- no recrear sesiones canceladas manualmente sin decisión explícita
- no generar para partidas pausadas/cerradas/canceladas
- si falla una creación automática, registrar warning y mostrar aviso a máster
  cuando abra la partida

Autoapuntado:

- si hay más jugadores que plazas, avisar y pedir decisión
- si un jugador ya está apuntado, no duplicar
- si un externo no puede recibir privados, mantener participación pero avisar en
  resumen operativo cuando corresponda

Material:

- si falla la copia interna a Storage, no crear material huérfano
- si falla un envío de handout, registrar entrega fallida y mostrar resumen
- si un usuario intenta abrir un handout sin permiso, responder con acceso
  denegado sin revelar título sensible cuando sea `gm_only`
- las búsquedas LLM que consulten Storage, incluyendo `storage.search` o
  búsquedas transversales tipo `bot.search`, deben excluir handouts internos
  igual que `/storage`

Cancelación:

- todo flujo guiado debe poder cancelarse
- cancelar no deja teclado huérfano ni sesión en estado parcial
- después de cancelar se vuelve al estado normal del bot

## Auditoría y observabilidad

Registrar eventos importantes en `audit_log` o mecanismo equivalente:

- creación de partida
- edición de configuración sensible
- cambio de máster principal
- alta/baja de coorganizador
- solicitud de plaza
- aceptación/rechazo
- creación de sesión desde partida
- generación recurrente de sesión
- subida de material
- revelado de handout
- envío de handout
- cierre/cancelación de partida

Warnings estructurados:

- fallo de generación recurrente
- fallo de envío de handout
- intento de acceso sin permiso a material
- inconsistencia de vínculo Agenda/partida
- inconsistencia de vínculo Storage interno/material

## Pruebas

Pruebas de dominio/repositorio:

- crear, leer, actualizar y cerrar partidas
- visibilidad privada, socios y pública
- solicitudes manuales y autoaceptación hasta llenar plazas
- lista de espera o rechazo cuando no hay plazas
- roles de máster principal, coorganizador, jugador y admin
- restricción de único máster principal activo
- CRUD de materiales y entregas
- vínculos de sesión con Agenda

Pruebas de Telegram:

- menú `Rol` visible para socios aprobados
- `Rol` no disponible para usuarios no aprobados salvo deep links públicos
- creación de one-shot con sesión inicial
- creación de campaña manual
- creación de campaña recurrente
- cancelar en cada flujo vuelve a estado normal
- acciones importantes aparecen resaltadas
- listas paginadas con pie correcto
- detalle de partida filtra acciones por permisos
- socio solicita plaza
- máster acepta/rechaza solicitud
- autoaceptación hasta llenar plazas
- externo abre one-shot pública y solicita/apunta sin convertirse en socio
- jugador confirmado programa siguiente sesión manual si está permitido
- coorganizador programa sesión y gestiona material
- coorganizador no puede cambiar máster principal ni cerrar partida

Pruebas de sesiones:

- sesión creada desde one-shot queda en Agenda y vinculada
- sesión manual precarga datos de partida
- recurrencia mantiene la ventana móvil configurada
- recurrencia no duplica sesiones
- recurrencia no recrea sesión cancelada manualmente
- autoapuntado añade jugadores confirmados
- autoapuntado desactivado no añade participantes
- capacidad insuficiente muestra aviso antes de confirmar

Pruebas de material:

- subida desde partida crea material vinculado
- material `gm_only` sólo visible para máster/coorganizador/admin
- material `players` visible para jugadores confirmados
- handouts no aparecen en `/storage`
- handouts no aparecen en búsqueda de Storage
- handouts no aparecen en listados normales de Storage
- deep link `role_material_<id>` aplica permisos de `Rol`
- `Enviar sólo esta vez` envía y conserva oculto
- `Enviar y revelar` envía y cambia a visible para jugadores
- `Revelar sin enviar` cambia visibilidad sin enviar privados
- entrega parcial muestra resumen de fallidos

Validación final:

- tests focalizados de `Rol`
- tests focalizados de Agenda afectada
- tests focalizados de Storage interno afectado
- `npm run typecheck`
- `npm run db:check` si hay migraciones
- `./scripts/feature-status-audit.sh`
- `./startup.sh`

## Documentación

Actualizar `docs/feature-status.md` cuando se implemente porque cambia la
capacidad visible del bot:

- nuevo botón privado `Rol`
- organización de campañas y one-shots
- sesiones vinculadas a Agenda
- handouts internos ocultos de Storage
- acceso público controlado para one-shots de puertas abiertas

Si la implementación toca comportamiento LLM en una iteración posterior, deberá
actualizar también `docs/llm-natural-language.md`. La v1 no añade intents LLM.

## Plan de implementación futuro

La implementación debería partirse en hitos:

1. Modelo de datos, repositorios y permisos de partida.
2. Menú `Rol`, listados, detalle y creación básica.
3. Integración con Agenda para one-shots y sesiones manuales.
4. Campañas recurrentes con ventana móvil.
5. Material interno y ocultación desde Storage.
6. Entrega/revelado de handouts.
7. Acceso público controlado para externos.
8. Documentación, feature status y validación completa.

Cada hito debe mantener el bot arrancable y probado antes de pasar al siguiente.
