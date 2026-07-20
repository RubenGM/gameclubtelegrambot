# Estado real de features

Última revisión: 2026-07-19.

Este documento refleja lo que existe en el codigo actual, no solo lo que aparece en planes o specs. Los estados usados son:

- `operativo`: implementado en el bot, persistido si aplica y cubierto por tests relevantes.
- `parcial`: hay implementacion usable, pero falta una parte importante de UX, operacion o alcance.
- `pendiente`: esta documentado o preparado en modelo/backlog, pero no hay flujo completo en el bot.
- `tecnico`: capacidad de infraestructura u operacion, no una feature visible para socios.

## Resumen ejecutivo

```text
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
| Feature                                      | Estado               | Lectura actual                                                                                                                       |
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
| Runtime, configuración y despliegue          | 🟢 Operativo        | Base TypeScript, PostgreSQL, Drizzle, bootstrap, long polling, reintentos Telegram, systemd/tray y backups.                           |
| Acceso, usuarios y admins                    | 🟢 Operativo        | Solicitud/aprobación/rechazo/revocación, autojoin por grupo, nickname, bienvenidas, avisos privados y alta web en `/alta`.            |
| Idioma, menús y ayuda                        | 🟢 Operativo        | `ca`, `es`, `en` + menú por rol/contexto, Avisos, LFG, Rol y ayuda contextual por sección activa.                                     |
| Asistente LLM de órdenes naturales           | 🟠 Parcial          | `/ask` para socios y `/adminai` confirmado para abrir opciones admin; lecturas MVP y escrituras generales parciales.                  |
| Mesas                                        | 🟢 Operativo        | Administración de mesas y consulta de tablas activas para socios.                                                                     |
| Agenda de actividades                        | 🟢 Operativo        | Crear/listar/editar/cancelar, apuntarse/salir, actividades públicas, conflictos, recordatorios y feeds de noticias.                   |
| Eventos del local                            | 🟢 Operativo        | Gestión admin de eventos con impacto directo en agenda y resumen diario, con progreso editable.                                       |
| Catálogo                                     | 🟢 Operativo        | CRUD, familias, búsqueda, media URL/adjunto con Storage, BGG/Open Library/Wikipedia y procesos con progreso editable.                 |
| Préstamos                                    | 🟢 Operativo        | Flujo principal, recordatorios privados, dashboard admin de préstamos activos y avisos de fecha prevista/vencimiento.                 |
| Grupos de noticias                           | 🟢 Operativo        | `/news` por categoría para grupo completo o topic, incluido `public-events`; `/admin/news` resume feeds activos.                      |
| Avisos                                       | 🟢 Operativo        | Socios y admins crean, ven, editan y archivan avisos con formato/adjuntos en destinos `/news avisos`.                                 |
| Compras conjuntas                            | 🟢 Operativo        | Crear/listar/unirse/confirmar, descripciones, `/news group-purchases`, participantes y recordatorios.                                 |
| Rol / partidas de rol                        | 🟢 Operativo        | Campañas/one-shots, personajes, sesiones, recurrencia anclada, invitaciones privadas y handouts internos.                             |
| Storage / Archivos                           | 🟢 Operativo        | Índice de adjuntos con categorías, permisos, búsquedas, cargas Telegram y gestión admin web/TUI sin creación web.                     |
| Impresión                                    | 🟢 Operativo        | Botón privado, estados admin, PDF/Office/imágenes desde adjunto o Storage, páginas/copias/caras e historial.                          |
| Backups, operación y panel web               | 🟢 Operativo        | CLI/TUI de backup/restore, gestión Debian, dashboard web, Storage web, bienvenidas, temas y páginas públicas.                         |
| Analytics / UX                               | 🟡 Técnico parcial  | Reporte/TUI operativo y herramientas Codex para leer imágenes y medir modelos; mejoras de analítica avanzada pendientes.              |
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
```


Leyenda: 🟢 operativo, 🟠 parcial, 🟡 técnico.

## Runtime y operacion

Estado: `tecnico operativo`.

Implementado:

- Arranque principal en `src/main.ts` y `src/main-program.ts`.
- Configuracion runtime validada con `zod` y editor/wizard en `src/config/*` y `src/bootstrap/*`.
- PostgreSQL con Drizzle, schema central y migraciones en `src/infrastructure/database/schema.ts`.
- Long polling con `allowed_updates` limitado a `message` y `callback_query` en `src/telegram/runtime-boundary-support.ts`.
- Capa intermedia de reintentos para envios y operaciones Telegram en `src/telegram/telegram-api-retry.ts`, usada desde el boundary runtime; respeta `retry_after` de Telegram sin recortarlo al máximo de backoff propio.
- Canario de salud de Telegram API: detecta fallos transitorios y mantiene estado degradado temporal para diagnóstico interno sin añadir avisos a las respuestas visibles del bot.
- El middleware global de Telegram responde los errores inesperados con el detalle exacto saneado para operador/usuario, en vez de ocultarlos tras un mensaje generico.
- Scripts de operacion, systemd, tray Debian y backups documentados en `README.md`, `docs/debian-service-operations.md`, `docs/debian-tray-operations.md` y `docs/backup-restore-recovery.md`.
- Herramientas `npm run codex:image` y `npm run codex:benchmark`, junto con `scripts/codex-cawa.sh`, para consultar imágenes y medir modelos Codex con el usuario operador; la lectura de portadas y el fallback LLM de traducción del catálogo usan `gpt-5.4` por defecto y no sustituyen las fuentes de metadatos BGG/Open Library/Wikipedia.
- Panel HTTP integrado en el servicio del bot (`src/http/admin-http-server.ts`): portada pública en `/`, feedback público en `/feedback`, alta de socio en `/alta`, información del club en `/club`, actividades futuras en `/actividades`, catálogo público enriquecido en `/catalogo`, admin protegido en `/admin` y edición de marca/contenido/tema, enlaces destacados y assets de portada en `/admin/web`.
- El despliegue público usa Nginx como reverse proxy hacia `127.0.0.1:8787` con HTTPS de Let's Encrypt para `cawa.hopto.org`.

Riesgos o pendientes:

- El bot usa polling, no webhook. Esta bien para el despliegue actual, pero no hay hardening de webhook porque no aplica.
- `featureFlags` existe en configuracion, pero la mayoria de features visibles no estan realmente gateadas por flags.

## Acceso, usuarios y admins

Estado: `operativo`.

Implementado:

- `/access` pide primero el nombre visible con el que el usuario quiere ser conocido en el bot; ese nickname se guarda en `users.display_name` y se usa en avisos y bienvenidas.
- Los socios aprobados tienen la accion "Cambiar nombre de usuario" en el teclado principal para actualizar su nombre visible sin depender del username de Telegram.
- `/access` crea solicitudes y soporta reintentos segun estado del usuario.
- `/review_access`, `/approve`, `/reject` y callbacks inline resuelven solicitudes.
- `/manage_users` abre una pantalla de gestion: lista usuarios registrados con nombre enlazado al detalle, username clicable, estado y rol.
- El detalle de usuario resume identidad, estado, rol, prestamos activos, actividades futuras y actividades recientes.
- Desde el detalle, los admins pueden expulsar socios no admin con motivo, ascender socios a admin y eliminar rol admin sin revocar acceso de socio.
- La gestion de rol admin escribe auditoria en `user_permission_audit_log` y `audit_log`.
- `/elevate_admin` eleva a admin usando hash de password runtime.
- `/subscribe_requests` y `/unsubscribe_requests` permiten avisos privados de nuevas solicitudes.
- `/adminai {petición}` permite a un admin expresar en lenguaje natural la opción del bot que quiere abrir. Codex devuelve un plan estructurado con un único destino de allowlist; el bot muestra siempre explicación, lista numerada de acciones y botones inline `Aceptar`/`Cancelar`. Sólo tras aceptar se vuelve a comprobar el rol y el contexto, se registra la confirmación sin guardar el prompt literal y se abre el flujo guiado o comando local existente. No admite shell, SQL, HTTP, argumentos libres ni escrituras directas de la LLM.
- `/autojoin enabled` y `/autojoin disabled` permiten a admins activar por grupo el alta automatica: cada usuario no bot que entre en un grupo con autojoin activado se crea como pendiente si hace falta, queda aprobado como miembro y recibe una bienvenida de grupo si hay plantillas activas; con autojoin desactivado, la entrada al grupo no aprueba ni envia bienvenida. Los usuarios bloqueados no se reactivan automaticamente.
- `/alta` registra solicitudes de alta desde la web en `member_signup_requests`, avisa por privado a admins aprobados y publica en grupos suscritos al feed `nuevos_miembros`.
- `/admin/member-signups` permite revisar desde el panel web las solicitudes de alta recibidas, su estado, el resumen de avisos enviados y marcar cada solicitud como contactada, aprobada, rechazada o pendiente.
- `/admin/welcome` permite a admins configurar plantillas aleatorias de bienvenida de grupo, con placeholder `$USERNAME`, GIF opcional mediante Telegram animation file ID, plantillas globales y plantillas especificas por Telegram user ID.
- Al aprobar una solicitud desde Telegram (`/approve` o callbacks de revisión), el bot no envía bienvenida privada ni publica plantillas en grupos. Las bienvenidas de grupo se envían sólo cuando Telegram informa de una entrada real al grupo y ese grupo tiene `/autojoin enabled`.
- El teclado privado inicial de admins mantiene las acciones diarias de socio y agrupa las herramientas administrativas tras el botón `Admin`; dentro de ese submenú está `Bienvenidas`, que lista las plantillas actuales con paginacion por botones de teclado, pie visible `Mostrando X-Y de Z. Página A/B`, un enlace inline compacto junto a cada plantilla para abrir su detalle, acciones de detalle para previsualizar, editar texto, editar GIF/video, activar/pausar, eliminar y crear una bienvenida nueva directamente desde Telegram enviando el texto con formato Telegram conservado (negrita, cursiva, etc.) y despues un GIF/video opcional como adjunto, aceptando animaciones Telegram, videos convertidos por el movil y archivos `.gif`.
- En privado, los aliases secretos `Welcome`, `/welcome`, `Bienvenida` y `/bienvenida` envian al usuario una previsualizacion real de la bienvenida aleatoria que le tocaria, usando su nombre visible guardado; `/welcome 1` y `/bienvenida 1` fuerzan una plantilla concreta por posicion visible.
- Las revocaciones notifican al usuario afectado y a admins suscritos.
- Persistencia y auditoria en `users`, `user_status_audit_log`, `user_permission_assignments` y `user_permission_audit_log`.

Riesgos o pendientes:

- No hay una UI general para conceder/revocar cualquier permiso global o por recurso. Hay flujos especificos para rol admin, revocacion de acceso, storage category access y permiso global de impresión.

## Idioma, menus y ayuda

Estado: `operativo`.

Implementado:

- `/language` y flujo de idioma en privado/grupo.
- Menu principal dinamico por rol, estado, chat y sesion en `src/telegram/action-menu.ts`.
- El menu aprobado/admin muestra "LFG (buscar grupo)", "Rol", "Avisos" y una accion visible para cambiar el nombre mostrado por el bot; el menu raiz de admins añade un botón `Admin` que abre las herramientas administrativas sin mezclar solicitudes, usuarios, mesas admin y bienvenidas con las acciones diarias.
- `Inicio` y `/start` normal limpian cualquier sesion activa antes de reconstruir la portada, evitando dejar al usuario atrapado con un teclado de `/cancel`, y muestran hasta 3 avisos activos recientes.
- Ayuda contextual en `src/telegram/command-registry.ts` y seccion activa gestionada desde `runtime-boundary-registration.ts`.
- Soporte visible para `ca`, `es` y `en`.

Riesgos o pendientes:

- Muchos flujos dependen de comparar texto localizado de botones. Cambios de copy pueden romper acciones si no se actualizan tests.

## Rol / partidas de rol

Estado: `operativo`.

Implementado:

- Botón privado `Rol` para socios aprobados y admins en el menu raiz, manteniendo herramientas administrativas dentro de `Admin`.
- Comandos `/rol` y `/role_games`, además del botón `Rol`, abren directamente `Mis partidas`; el teclado conserva `Partidas visibles` y `Crear partida` como acciones secundarias.
- Home con `Mis partidas`, `Partidas visibles`, `Crear partida` y `Cancelar` con rol danger.
- Listas read-only de partidas propias y visibles desde `RoleGameRepository`, con paginacion estilo Telegram y deep links `role_game_<id>` al detalle.
- El detalle de partida funciona como portada con teclado persistente, resume ocupación, solicitudes pendientes y la sesión futura enlazada más próxima (o su ausencia), y ofrece los submenús de Participantes, Sesiones, Materiales, Invitar y Configurar sin depender de acciones inline bajo el mensaje.
- `Personajes` aparece en esa portada para cualquier miembro confirmado —incluidos GM principal y coorganizadores— y para admins globales. Al entrar abre directamente `Mis personajes`, manteniendo en el teclado las vistas de campaña y libres, la creación y las acciones de gestión autorizadas. Visitantes, solicitudes pendientes y miembros históricos no ven ni pueden abrir la sección.
- Cada miembro confirmado puede mantener varios personajes propios con nombre, descripción opcional, URL `http/https` opcional y privacidad `players` o `private`. La edición confirma y persiste cada campo de forma atómica; las previsualizaciones respetan el formato HTML de Telegram. Un personaje público es visible para todos los miembros confirmados; uno privado sólo para su propietario y los GM operativos.
- Los jugadores crean personajes asignados exclusivamente a sí mismos. GM principal, coorganizadores confirmados y admins pueden crearlos para cualquier miembro confirmado o dejarlos libres, y asignarlos, transferirlos o desasignarlos mediante confirmación sin modificar el rol ni el estado del participante.
- Los personajes públicos libres admiten solicitudes. El jugador puede cancelar la suya y los GM las revisan con aprobación o rechazo; la aprobación asigna de forma atómica y cancela las solicitudes rivales. Los cambios de asignación y resolución se notifican por privado en modo best-effort.
- Abandonar un personaje lo deja libre sin borrarlo. Cuando un miembro confirmado pasa a `left` o `removed`, todos sus personajes se desasignan dentro de la misma transacción; una promoción o degradación entre roles confirmados conserva sus personajes.
- Las vistas `Mis personajes`, `Personajes de la campaña` y `Personajes sin asignar` muestran cada personaje como enlace de texto al detalle `role_character_<id>` y reservan el teclado persistente para acciones, navegación y paginación. Las selecciones de miembros, solicitudes y adjuntos conservan mapas de botones ligados a la sesión; todas las listas mantienen páginas de seis elementos. El detalle de personaje se abre sólo si está autorizado y responde sin revelar la existencia o el nombre cuando no hay acceso.
- Cada personaje admite adjuntos independientes de documento, foto, vídeo o audio. Propietario y GM pueden añadir, reemplazar, retirar y cambiar su privacidad; la audiencia se vuelve a comprobar al abrirlos y los adjuntos privados sólo llegan al propietario actual y a los GM.
- La creación y edición permiten añadir, sustituir o retirar un único retrato mediante foto o documento de imagen. El retrato se guarda como adjunto interno especializado y, al abrir el personaje, el bot envía primero la ficha textual y justo después copia el retrato si existe.
- Cada adjunto de personaje usa una entrada de la categoría interna `role_game_handouts`; el flujo de Rol crea la categoría/topic si falta, intercambia enlaces con compare-and-set al reemplazar y hace limpieza lógica best-effort. Estas entradas siguen ocultas y bloqueadas en navegación, búsqueda, detalle directo, edición, borrado, tags e impresión genéricos de Storage.
- `Crear partida` inicia un flujo guiado cancelable para crear la partida base con tipo, título, sistema, descripción, plazas, visibilidad, modo de entrada, aceptación y periodicidad.
- `Editar partida` inicia un flujo guiado cancelable para cambiar titulo, sistema, descripcion, plazas, visibilidad, modo de entrada, aceptacion, programacion manual por jugadores, publicacion Agenda por defecto y estado.
- `Cancelar partida` permite al GM principal y a los admins globales cancelar campañas y one-shots desde `Configurar`, con confirmación explícita. Conserva la partida y su historial, fija el estado `cancelled`, detiene la generación recurrente y la retira de las listas activas.
- `Eliminar partida` permite al GM principal y a los admins globales borrar definitivamente campañas y one-shots desde `Configurar`. Exige escribir el título exacto y una confirmación final; elimina personajes, solicitudes, adjuntos, materiales, categorías y participantes, marca como borradas las entradas Storage internas y cancela las sesiones Agenda vinculadas. La opción `Configurar` permanece disponible para propietarios de one-shots aunque no admitan recurrencia.
- `Invitar jugadores` mantiene el enlace `role_game_<id>` compartible y añade una lista paginada de socios aprobados con hasta 15 personas por página. Cada persona aparece como un deep link clicable en el cuerpo del mensaje, mientras el teclado queda reservado para paginación, salto directo de página y navegación; también se puede enviar su `@usuario`. GM, coorganizadores y admins pueden iniciar la invitación, el bot crea una invitación pendiente y escribe al destinatario por privado con botones `Aceptar` y `Denegar`. Sólo el destinatario puede responder, la aceptación vuelve a comprobar el aforo de forma atómica y un fallo al enviar el mensaje retira la invitación pendiente.
- Los one-shots piden fecha y hora en la creación, muestran una confirmación de Agenda con todos los datos exactos de la actividad y sólo después generan una primera sesión en `schedule_events` enlazada con `role_game_sessions`.
- Las sesiones iniciales de one-shots y las sesiones manuales creadas desde Rol ejecutan las mismas notificaciones posteriores que una actividad creada desde Agenda: actualizan los snapshots de los grupos/topics suscritos a `events` y, cuando corresponde, a `public-events`.
- Las campañas activas en modo manual muestran `Programar siguiente sesión` a GM/coorganizadores/admins, y también a jugadores confirmados si la partida permite programación manual por jugadores; one-shots, partidas pausadas y campañas recurrentes no exponen esta acción manual. Tras introducir fecha y hora, el bot todavía no escribe nada: pregunta claramente si se quiere crear 1 actividad, muestra nombre, día completo, franja horaria, duración, tipo, visibilidad, plazas, mesa y descripción, y exige pulsar `Confirmar`; `Cancelar` deja Agenda intacta.
- La periodicidad de campañas ofrece `Sin días fijos`, `1` y `2` en el teclado y también acepta un número de semanas. `Sin días fijos` activa exclusivamente la programación manual; una frecuencia numérica pide el día de la semana mediante siete botones y después obliga a elegir la siguiente partida entre las cuatro próximas fechas coincidentes antes de pedir hora y ventana futura.
- Las campañas pueden reconfigurar esa periodicidad desde `Configurar recurrencia`. Antes de guardar, una planificación sin escrituras descuenta las sesiones futuras ya existentes, pregunta si se quieren escribir exactamente X actividades y enumera todos sus días y horas junto con los datos comunes completos. Al confirmar vuelve a calcular la planificación y, si algo ha cambiado, obliga a revisar de nuevo; sólo una confirmación vigente crea el lote mostrado. La regla recurrente persiste la fecha elegida como anclaje `startsOn`, para que el worker mantenga la cadencia y la ventana futura sin inventar la primera ocurrencia; las sesiones canceladas enlazadas no se recrean.
- Las sesiones de rol reutilizan Agenda: crean eventos con `createScheduleEvent`, enlazan `role_game_sessions`, apuntan automaticamente a jugadores confirmados hasta la capacidad disponible cuando la partida lo configura y enlazan el recibo a `schedule_event_<id>`.
- GM principal y admins gestionan solicitudes, listas de espera, jugadores y coorganizadores; los coorganizadores conservan la resolución operativa de solicitudes y el envío de invitaciones directas. Los cambios de estado o rol comparan el estado de origen y cualquier transición que ocupe una plaza confirma capacidad de forma atómica.
- Participantes activos e historial separado se muestran con identidad visible, rol del GM principal, estado, fecha relevante y paginación. Cada fila enlaza al detalle del participante mediante `role_game_participant_<game>_<member>_<vista>_<página>` y el teclado queda reservado para historial, paginación y navegación; nadie puede promocionarse a sí mismo y los estados históricos no permiten reactivación ni nuevas solicitudes desde Telegram.
- La solicitud de plaza comparte la misma validación de capacidad entre visibilidad y ejecución. Los one-shots públicos con política `members_and_external` se pueden abrir desde `/start role_game_<id>` por usuarios no aprobados y permiten solicitar plaza externa sin aprobar automáticamente la membresía del usuario.
- Un admin global que consulte una partida privada o de sólo invitación sin ser todavía participante ve inicialmente la ficha normal de jugador, puede solicitar plaza y dispone de `Abrir como administrador` para activar temporalmente las herramientas administrativas de esa partida. La solicitud no usa privilegios para saltarse el aforo ni la revisión configurada por el GM y queda registrada como miembro interno pendiente o confirmado según la política de aceptación de la partida.
- Infraestructura Storage para handouts internos con proposito `role_game_handouts`, oculto de Storage normal, `/storage`, busquedas, web/TUI Storage y busquedas LLM.
- Los managers pueden subir uno o varios adjuntos como un único pack desde la ficha de partida. El bot recoge los archivos mediante teclado persistente, pide obligatoriamente el nombre con una sugerencia basada en el caption o el archivo y sólo entonces los copia con progreso editable. Si todavía no existe la categoría interna de handouts, crea automáticamente su topic y categoría en el supergrupo Storage por defecto antes de guardar el pack como un único `role_game_materials` `gm_only`, sin exponer `storage_entry_<id>`. Al completar la subida conserva la sesión en `Materiales`, de modo que `Volver a la partida` mantiene la navegación de Rol y no cae en el fallback de IA.
- `Materiales` lista handouts subidos desde Rol con paginación mediante teclado de respuesta persistente cuando corresponde, enlazando sólo `role_material_<id>` y sin abrir acceso a Storage.
- Los handouts se organizan en categorías y subcategorías jerárquicas privadas de cada partida, sin reutilizar ni mostrar el árbol global de Storage, con navegación mediante enlaces de texto y paginación conjunta de carpetas y materiales. Los uploads nuevos se guardan en la categoría abierta; el contenido anterior permanece en la raíz sin categoría y los managers pueden moverlo después a cualquier categoría de esa misma partida.
- Al abrir un handout, el bot envía directamente todos sus adjuntos en orden para que el usuario pueda identificar el contenido y mantiene sus acciones en el teclado de respuesta. Los managers pueden enviarlo sólo esta vez, enviarlo y revelarlo, revelarlo sin envío o eliminarlo tras una confirmación explícita; además pueden elegir a un jugador confirmado concreto para enviárselo o revelárselo en privado, sin cambiar la visibilidad global ni conceder acceso al resto. La revelación individual queda registrada y permite únicamente al destinatario confirmado volver a abrir `role_material_<id>`. También pueden ejecutar las acciones de envío y revelado sobre una categoría completa, incluyendo recursivamente todas sus subcategorías, con progreso editable y resumen agregado. Al eliminar un handout se retiran su historial de entregas y su referencia de Rol, y la entrada interna se marca como eliminada en Storage. El bot registra `role_game_material_deliveries`, resume fallos parciales y aplica permisos de Rol a `role_material_<id>`.

## Asistente LLM de órdenes naturales

Estado: `parcial`.

Implementado:

- Configuración runtime `llmCommands` con variables `GAMECLUB_LLM_COMMANDS_*`, apagada por defecto mediante `GAMECLUB_LLM_COMMANDS_ENABLED=false`.
- Documentación operativa mantenida en `docs/llm-natural-language.md`; cualquier cambio en interacción LLM/chat natural debe actualizar esa guía en el mismo cambio.
- Servicio de invocación LLM operativo exclusivamente con Codex: perfil normal `gpt-5.6-luna`/`low` y perfil reforzado `gpt-5.6-sol`/`low`, timeout y errores clasificados; Codex se invoca mediante `GAMECLUB_CODEX_BIN`, `codex exec --ephemeral --sandbox read-only` y schemas de salida.
- Contrato JSON versionado, parser estricto, schemas JSON para Codex, allowlist de intents/actions, umbrales locales de confianza (`0.75` lectura, `0.90` escritura) y rechazo de acciones administrativas con el copy obligatorio.
- Prompt generado desde un catálogo tipado de capacidades permitidas por rol/contexto, sin dar autoridad a la LLM para ejecutar lógica de negocio.
- La primera pasada puede pedir `nextStep.useStrongerModel`; el bot valida localmente esa señal y sólo escala la siguiente llamada de lectura semántica para `bot.search`, `catalog.detail`, `catalog.recommend` y `storage.search`. Los perfiles activos son `GPT-5.6-Luna`/`low` y `GPT-5.6-Sol`/`low`; los admins pueden ajustarlos desde `Admin` -> `Modelos IA` entre los modelos Codex permitidos, persistiendo la selección en `app_metadata`.
- El selector admin de `Modelos IA` muestra una tabla comparativa con el último test guardado por combinación, permite lanzar un test pequeño desde Telegram y guarda el resultado en `data/llm-model-tests/<modelo>_<reasoning>.json`, sobrescribiendo el resultado anterior de esa misma combinación; duración, éxitos/fracasos, tokens y coste se muestran, dejando tokens/coste como `n/d` si Codex no los expone de forma fiable.
- Comando privado `/ask` para socios aprobados.
- Botón privado `Preguntar al bot` visible sólo cuando la feature está habilitada.
- Fallback privado configurable con `GAMECLUB_LLM_COMMANDS_PRIVATE_FALLBACK_ENABLED`, ejecutado al final de la cadena de handlers para no capturar comandos ni botones. Las sesiones pasivas de lectura de catálogo no bloquean el fallback LLM cuando el texto libre no coincide con acciones del detalle.
- Lecturas en grupos/topics cuando el usuario menciona explícitamente al bot o responde a un mensaje suyo; las respuestas conservan `message_thread_id`, ofrecen abrir el privado y envían a la LLM el texto del mensaje del bot respondido como contexto conversacional.
- Sesión LLM conversacional con expiración funcional de 15 minutos dentro del flujo `llm-command`.
- Recibo/progreso editable inmediato para peticiones LLM: el bot confirma recepción antes de invocar el proveedor LLM, muestra una barra aproximada y textos breves de estado sin exponer la petición completa, edita el mismo mensaje con estados intermedios mientras espera a la IA y lo completa con lectura, aclaración, rechazo o confirmación.
- La LLM puede devolver `progress.messages` con hasta 4 textos cortos y personalizados para que el bot los muestre durante la búsqueda de datos o la preparación del siguiente paso; el bot los sanea, mantiene fallback genérico y no permite que esos mensajes ejecuten lógica.
- Lecturas MVP desde repositorios internos para ayuda, agenda, catálogo, préstamos, Storage, avisos, compras conjuntas, LFG y estado básico de `/news`; los listados directos muestran hasta 12 elementos, las búsquedas multi-fuente mantienen 5 por sección para controlar longitud, enlazan a los detalles del bot cuando existe deep link estable y añaden enlaces de continuación para abrir el listado completo cuando hay más resultados.
- `general.answer` permite respuestas conversacionales o preguntas generales que no necesitan datos internos del bot; las consultas sobre agenda, catálogo, Storage, préstamos, avisos, compras, LFG o noticias siguen obligadas a pasar por handlers internos.
- Búsqueda multi-fuente `bot.search` para peticiones transversales como “qué tenemos de Star Wars”: consulta en paralelo agenda, catálogo, Storage, compras conjuntas, avisos y LFG, respeta fuentes restringidas por la LLM y puede entregar los resultados estructurados a una segunda pasada LLM para redactar una respuesta útil sin inventar datos.
- Las lecturas que necesitan interpretación pueden crear un feedback loop: el bot consulta repositorios internos, envía datos reales y contexto de reply a la LLM mediante schema de respuesta, escapa el texto resultante y añade enlaces generados por código; si falla la síntesis, usa el render determinista con enlaces.
- Las preguntas sobre una ficha de catálogo respondida infieren el título de la ficha si la LLM omite `query`; `catalog.detail` recupera ese ítem concreto y entrega metadatos de catálogo/BGG a la segunda pasada LLM para responder sobre lo que el usuario haya preguntado.
- El prompt distingue catálogo físico/prestable frente a Storage como repositorio de archivos, incluyendo STL y material de rol como libros, manuales, aventuras, fichas y mapas, para clasificar mejor consultas ambiguas.
- Las recomendaciones LLM de catálogo usan `catalog.recommend`: el bot filtra juegos reales por tipo, disponibilidad y número de jugadores, usa la consulta como señal de ranking semántico sobre texto y metadatos BGG en vez de como filtro duro, aplica fallback a rangos cercanos, juegos prestados o metadatos incompletos cuando no hay coincidencia exacta, envía candidatos con metadatos a la LLM para elegir, y renderiza la respuesta con enlaces a los detalles del bot.
- La importación/autocorrección BGG guarda metadatos útiles para recomendaciones: peso medio, rating, bayes average, usuarios, votos de peso y rangos de jugadores recomendados por encuesta, además de categorías y mecánicas.
- Las búsquedas LLM de Storage refinan los candidatos visibles con una segunda pasada semántica sobre descripción, ruta completa de categoría, tags y archivos para separar, por ejemplo, material de rol/PDF de modelos STL con la misma franquicia; si la consulta coincide con una categoría visible, el bot incluye también sus descendientes para encontrar archivos guardados en subcarpetas específicas, y trata todo lo que cuelga de la categoría raíz de STL como contenido de impresión 3D (`STL`, modelos 3D, figuras, estatuas, miniaturas o dioramas) en vez de exigir extensión `.stl` literal. Los handouts internos de Rol no se devuelven por `storage.search` ni por la sección Storage de `bot.search`.
- Timeout LLM por defecto ampliado a 60s para reducir cortes en grupos y búsquedas con refinado semántico; los timeouts se comunican con mensaje específico al usuario.
- Las lecturas usan el riesgo local de la allowlist por encima del `safety.risk` devuelto por la LLM, de modo que consultas como agenda semanal no caen en confirmación/prellenado aunque la LLM clasifique mal la salida.
- Métricas saneadas persistidas en `audit_log` con intención, confianza, origen, tipo de chat, resultado, duración y motivo; no guardan texto literal del usuario, prompt completo ni respuesta completa de la LLM.
- Confirmación LLM previa para escrituras y preparación/delegación a flujos normales para `notice.create`, `notice.archive`, `lfg.create`, `schedule.join`, `schedule.leave`, `group_purchase.join`, `catalog.loan.create` y `storage.upload.start`; la persistencia final sigue dependiendo de los handlers estándar y sus confirmaciones cuando existan.
- Comando `/adminai` separado del asistente general, exclusivo de admins y disponible en privado/grupo/topic: usa el perfil reforzado, valida `admin-ai-plan.schema.json`, muestra siempre explicación + acciones + `Aceptar`/`Cancelar` y sólo despacha destinos administrativos allowlisted hacia los handlers existentes después de confirmar.

Riesgos o pendientes:

- Las pruebas comparativas se ejecutan contra los perfiles Codex disponibles; no hay proveedor LLM alternativo activo en el despliegue.
- Falta conectar prellenado equivalente para el resto de escrituras (`schedule.create`, creación/edición de catálogo, creación/edición de compras y edición de Storage) sin duplicar reglas de negocio.
- Las lecturas MVP son resúmenes básicos; falta UX de detalle largo por privado y selección guiada entre múltiples resultados.

## Mesas

Estado: `operativo`.

Implementado:

- Admin: crear, listar, editar y desactivar mesas en `src/telegram/table-admin-flow.ts`.
- Lectura: consulta de mesas activas en `src/telegram/table-read-flow.ts`.
- Las actividades pueden seleccionar mesa y usar aforo recomendado.

Riesgos o pendientes:

- No hay reserva exclusiva de mesa; la agenda permite solapes y avisa conflictos en vez de bloquearlos.

## Agenda de actividades

Estado: `operativo`.

Implementado:

- `/schedule` con crear, listar, editar, cancelar, detalle por deep link, unirse y salir.
- Soporte de fecha, hora, duracion, mesa opcional, juego de catalogo enlazado cuando se crea desde su detalle, modo abierto/cerrado, visibilidad pública sólo para mesas abiertas, plazas iniciales ocupadas, capacidad y mensaje extra opcional con adjuntos para detalles.
- Las actividades públicas siguen apareciendo en las listas internas normales y además permiten que usuarios de Telegram no aprobados abran el deep link de detalle y se apunten, sin convertirlos en socios del club.
- Si el usuario escribe solo la hora de inicio, el bot pasa a un paso especifico de minutos con botones rapidos (`:00`, `:15`, `:30`, `:45`) y copy propio.
- Preferencia de recordatorio al apuntarse y worker persistente de recordatorios.
- Avisos de conflicto y capacidad al crear/editar.
- Integracion con eventos del local para mostrar impacto.
- Listado y snapshots de grupo con enlace `Ver detalles` solo cuando la actividad tiene mensaje extra guardado; en ese caso no imprimen la descripcion larga en linea y el deep link reenvia el mensaje original al usuario.
- Publicación de snapshot a destinos de noticias suscritos; los feeds marcados por defecto como `events` llegan a todos los grupos de news habilitados salvo que ese feed tenga un destino explícito, incluido un topic. El feed separado `public-events` no se activa por defecto y publica sólo la agenda filtrada a actividades públicas. El bot recuerda el último snapshot por grupo/topic/categoría y borra el anterior tras publicar uno nuevo; si Telegram rechaza el borrado por antigüedad o permisos, edita el mensaje anterior a puntos suspensivos para que no queden dos calendarios largos visibles.

Riesgos o pendientes:

- No bloquea solapes; el comportamiento real es avisar y permitir continuar.
- Los recordatorios dependen del worker interno y de `notifications.defaults.eventRemindersEnabled`.

## Eventos del local

Estado: `operativo`.

Implementado:

- `/venue_events` para admins con crear, listar, editar y cancelar.
- Soporta eventos de dia completo o con horario, ocupacion parcial/total e impacto bajo/medio/alto; los avisos privados por impacto se envian con un mensaje de progreso editable para el admin.
- Impacto usado por agenda y resumen `Hoy en el club`.

Riesgos o pendientes:

- No hay gestion desde grupos; es flujo privado admin.

## Catalogo

Estado: `operativo`.

Implementado:

- `/catalog` para crear, listar, buscar, inspeccionar, editar y desactivar items.
- `/catalog_bulk` y el botón de menú "Añadir múltiples" para importar varios items en lote en background (separados por coma) con progreso editable y resumen final.
- Tipos: juegos de mesa, expansiones, libros, libros RPG y accesorios.
- Familias y grupos para agrupar lineas, colecciones o expansiones.
- Campos principales: titulo, original, descripcion, idioma, editorial, año, jugadores, edad, duracion, referencias externas y metadata.
- Propietario opcional por item: un usuario puede asignarse como propietario desde el detalle; los admins pueden asignar otro usuario con selector paginado y quitar el propietario. El detalle muestra el nombre enlazado.
- Media por URL con tipo `image`, `link` o `document`.
- Los admins pueden añadir imagen a un item existente desde el detalle usando URL o adjunto Telegram.
- Los admins pueden autocorregir datos de juegos/expansiones y libros desde el detalle: el bot reconsulta BGG/Open Library con el titulo o ID disponible, si BGG devuelve varias coincidencias muestra opciones para elegir manualmente, intenta traducir al castellano las descripciones BGG cuando el bot esta en español usando DeepL si esta configurado y Codex como fallback, actualiza campos, limpia referencias externas/metadata visibles, edita un mensaje de progreso con duracion por paso (API, traduccion, guardado, descarga/subida de portada y detalle) y reporta si la portada se ha importado, ya existia o no estaba disponible. Tambien pueden traducir solo la descripcion actual del item sin tocar el resto de datos usando progreso editable.
- El detalle admin de juegos/expansiones avisa al final cuando detecta una referencia BGG antigua sin metadatos modernos de rating, peso o jugadores recomendados, con enlace y boton de teclado para una importacion BGG rapida que actualiza solo metadata sin traducir descripcion ni importar portada; tras esa importacion rapida, el detalle actualizado enlaza el juego pendiente anterior y siguiente para revisar la cola con menos pasos. El comando privado secreto de admins `/update_bgg` y el boton `Actualizar BGG` del submenu Admin recorren todos los juegos/expansiones activos, aplican esa importacion rapida solo a los que la necesitan y mantienen un mensaje editable con barra de progreso y resumen final.
- Las imagenes reales del catalogo se guardan como entradas de Storage en una categoria interna `catalog_media`, oculta de la navegacion normal de `/storage`.
- La media principal de un item es la primera imagen por `sortOrder`, usando `0` como portada.
- Al abrir el detalle de un item, el bot intenta mostrar primero la portada principal y despues una ficha resumida con breadcrumbs, titulo, propietario si existe, disponibilidad, prestatario si existe, jugadores, duracion y enlace "Ver detalles" a la ficha completa.
- Las acciones del detalle de item se muestran en teclado de respuesta persistente para mantener libres los enlaces HTML dentro del mensaje; los detalles de lectura, préstamo y admin mantienen siempre `Inicio` y `Ayuda` al final del teclado para poder salir del contexto.
- En el alta de juegos/libros, el paso de nombre acepta una foto o documento de imagen de la portada; Codex sugiere el titulo y, si se crea el item, el bot pregunta si se guarda esa portada como imagen principal.
- `/catalog_search` como consulta para usuarios aprobados.
- Vista de lectura con indice por rangos de tres iniciales: cada bloque muestra total de articulos y desglose por juegos de mesa, libros y accesorios, con enlaces normales `t.me?...start=` en el texto; los grupos internos no aparecen en la navegacion principal.
- Vista publica `/catalogo` con busqueda por titulo/original/editorial, filtros por tipo, numero de jugadores y disponibilidad, paginacion, agrupacion por inicial, tarjetas con portada, descripcion, familia/grupo, propietario, disponibilidad/prestamo y datos principales, detalle publico por item con descripcion completa y enlace a BoardGameGeek cuando el item conserva referencia BGG.
- Creacion de actividad desde item del catalogo y aviso si el item esta prestado.
- Los avisos de prestamo en grupos de noticias intentan publicar una sola imagen: la portada principal del item; si falla, mantienen el texto actual.

Integraciones reales:

- Juegos de mesa: BGG es la fuente principal cuando `bgg.apiKey` esta configurada, con Wikipedia como fallback operativo.
- Libros y RPG: lookup HTTP hacia Open Library desde `catalog-lookup-service`, incluyendo portada cuando Open Library expone `cover_i`, `cover_edition_key` o ISBN utilizable.
- BoardGameGeek: importacion individual, autocorreccion desde detalle y coleccion operativas; la importacion de coleccion usa progreso editable durante la reconciliacion y, cuando BGG devuelve portada, el bot descarga la `imageUrl`/`coverUrl` y la sube a Storage como portada.
- Open Library: cuando devuelve portada, el alta intenta guardarla como portada.
- Codex: se usa para leer el titulo visible desde la portada con progreso editable y como fallback de traducción; los metadatos completos siguen viniendo de APIs catalogadas como BGG/Open Library/Wikipedia.

Riesgos o pendientes:

- El nombre historico `wikipedia-boardgame-import-service.ts` mezcla Wikipedia, Open Library y BGG collection, lo que puede confundir mantenimiento.
- La importacion automatica de imagenes externas es best-effort y muestra progreso editable cuando guarda media en Storage: si Telegram no acepta la URL o no hay Storage por defecto configurado, el item se crea igual.

## Prestamos

Estado: `operativo`.

Implementado:

- Crear prestamo desde botones del detalle/listado de catalogo.
- Devolver prestamo desde botones, visible solo para admins, quien tiene el item prestado o quien registro el prestamo.
- Consultar prestamos activos propios.
- Consultar todos los prestamos activos desde dashboard admin accesible por `/loan_admin` y por el menu de catalogo, con item y prestatario enlazados, fecha prevista y estado vencido.
- Editar notas y fecha prevista de devolucion.
- Enviar recordatorios privados cuando se acerca o vence la fecha prevista de devolucion.
- Publicar eventos de prestamo/devolucion a grupos de noticias por categoria, con el item enlazado al detalle de catalogo.
- Restriccion persistente de un prestamo activo por item.

Pendiente:

- Ninguna bloquejadora.

## Grupos de noticias

Estado: `operativo`.

Implementado:

- `/news status`, `/news enable`, `/news disable`, `/news subscribe <categoria>` y `/news unsubscribe <categoria>` en grupos y supergrupos con topics.
- Persistencia de grupos habilitados y suscripciones por categoria + destino (`chat_id` completo o `message_thread_id` concreto).
- `/news activar` dentro de un topic habilita el grupo y suscribe el feed de agenda (`events`) a ese topic para evitar que las actualizaciones de calendario caigan al general.
- Teclat inline de `/news` con `activar/desactivar`, `subscriure`, `desubscriure`, `refresh` y estado actual.
- Las respuestas administrativas de `/news` confirman feed y destino por nombre de grupo cuando Telegram lo proporciona, y se borran automaticamente tras 1 minuto para no ensuciar el grupo o topic; las publicaciones reales de feeds se conservan.
- Catálogo canónico de categorías de noticias y aliases reutilizado por agenda, agenda pública, LFG, préstamos, compras conjuntas y altas web (`nuevos_miembros`).
- Publicación de novedades por categoría concreta (agenda interna => `events`, agenda pública filtrada => `public-events`, Avisos => `avisos`, compras conjuntas => `group-purchases`, LFG, préstamos por tipo de ítem, altas web => `nuevos_miembros`) en el destino suscrito; los grupos habilitados reciben los feeds marcados por defecto, como `events` y `group-purchases`, si no tienen ese feed suscrito explícitamente.
- `/admin/news` muestra los feeds disponibles y cuántos destinos activos hay suscritos a cada categoría.

Pendiente:

- Ninguna bloquejadora.

## Avisos

Estado: `operativo`.

Implementado:

- Botón privado `Avisos` y comandos `/avisos`/`/notices` para socios aprobados y admins sin distinción de creación.
- Lista de avisos activos separada en dos mensajes: avisos propios cuando existan y avisos de otros socios siempre, aunque esté vacía; cada aviso incluye acciones inline para verlo y, si corresponde, editarlo o archivarlo.
- Creación guiada con texto Telegram conservado como HTML seguro, adjuntos múltiples copiados desde el privado, duración permanente, por horas o hasta un día concreto.
- Validación del tamaño final publicable en Telegram, incluyendo cabecera, HTML seguro y firma del creador, antes de confirmar un texto que superaría el límite de mensaje.
- Antes de crear, si no hay destinos suscritos a la categoría `/news` `avisos`, el bot avisa de que un admin debe configurar el canal/topic y no continúa.
- Publicación sólo en grupos/topics suscritos específicamente a `avisos`, guardando cada `chat_id`, `message_thread_id` y `message_id` publicado; el mensaje publicado no muestra la duración interna del aviso.
- Edición manual: el creador o cualquier admin puede modificar texto, adjuntos o duración; el bot borra las publicaciones anteriores y republica la versión actualizada.
- Archivo manual: el creador puede archivar sus propios avisos y cualquier admin puede archivar cualquier aviso; al archivar se intenta borrar automáticamente cada mensaje publicado.
- Expiración automática dentro del servicio cada 15 minutos: archiva avisos vencidos y borra sus publicaciones de forma best-effort.
- `Inicio` incluye hasta 3 avisos activos recientes en el resumen privado.
- Auditoría de creación, publicación, archivo manual y expiración.

Riesgos o pendientes:

- El borrado de mensajes publicados depende de que el bot tenga permisos adecuados en cada grupo/topic; si Telegram rechaza el borrado, el aviso queda archivado y el fallo se registra.

## Compras conjuntas

Estado: `operativo`.

Implementado:

- `/group_purchases` con crear y listar.
- Modos de compra por unidad o coste compartido.
- Descripciones enriquecidas con texto y adjuntos opcionales, botón directo de edición para admins/creador y enlaces de descripcion en mensajes privados y de grupo; al editar se conserva un unico mensaje de detalle e intenta borrar el anterior.
- Deadlines de union y confirmacion.
- Campos personalizados de participante: entero, opcion simple o texto; pueden afectar cantidad.
- Unirse como interesado o confirmado, editar valores, salir, gestionar participantes y cambiar estados.
- Publicación automática de nuevas compras en destinos `/news group-purchases`: por defecto llega al grupo completo habilitado, y si existe una suscripción explícita por topic se publica con su `message_thread_id`.
- Cada compra mantiene un único mensaje vivo por destino `chat_id` + `message_thread_id` y borra el mensaje anterior al publicar una actualización.
- Actualizaciones automáticas en grupos/topics cuando alguien se apunta, confirma, edita la compra o se echa atrás; incluyen botones inline para detalle, descripción y participación privada, y en coste compartido muestran coste total, coste actual por persona y usuarios confirmados.
- Mensajes asociados a una compra para trazabilidad interna.
- Recordatorios persistentes antes del deadline de confirmacion.

Riesgos o pendientes:

- No hay integracion de pagos; estados como pagado/entregado existen en modelo/flujo de participantes, pero no hay cobro real.

## Storage y archivos

Estado: `operativo`.

Implementado:

- `/storage` para usuarios aprobados en privado.
- Categorias con `storageChatId` y `storageThreadId` como ubicacion canonica.
- Configuracion admin de supergrupo de Storage por defecto desde Telegram, persistida en `app_metadata`.
- Alta de categorias usando automaticamente el supergrupo por defecto vigente: el bot valida chat/permisos, crea el topic y guarda los ids sin pedir confirmacion al crear cada categoria.
- Listado incremental de categorias principales/subcategorias con resumen agregado de subcategorias y archivos, enlaces normales `t.me?...start=` en el texto, breadcrumbs clicables, acciones contextuales, cambio guiado de categoria padre, movimiento de entradas por selector nivel a nivel y listado de entradas por categoria.
- Tags visibles como enlaces `#tag (X archivos)` hacia busqueda por tag, listado paginado de tags, entrada flexible sin `#` en prompts explicitos y gestion desde el detalle de archivo para propietario o admin.
- Criterio de organizacion visible en los flujos de subida: categorias para ubicacion/tipo general del contenido y tags para rasgos cruzados como criaturas, facciones, formatos, campañas o packs mixtos.
- Busqueda de Storage con entrada guiada para buscar por palabra/tag o explorar categorias nivel a nivel, normalizando `#tag` y buscando tambien por nombre de categoria.
- Las categorias internas `catalog_media` y `role_game_handouts` quedan fuera de la navegacion normal, busqueda, web/TUI Storage y enlaces `storage_entry_<id>`.
- Subida por DM: el usuario elige categoria con selector nivel a nivel, envia adjuntos con recibo editable del total del lote, finaliza, revisa tags con opcion de omitir, revisa una vista previa acotada para no superar el limite de Telegram con botones visibles para editar descripcion, añadir tags, añadir imagenes o completar, acumula imagenes adicionales con recibo editable, recibe aviso antes de completar sin tags y el bot muestra progreso editable con estado por adjunto mientras copia al topic canonico, indexa y notifica suscripciones; al terminar edita el recibo con enlaces directos a la entrada guardada y a su categoria.
- Subida por reenvio de mensajes de Telegram en privado: en modo neutral el bot pregunta que hacer, permite "Añadir a almacenamiento", acumula mensajes reenviados con un recibo editable del total del lote, pide categoria, precarga descripcion/tags/adjuntos/texto desde el mensaje reenviado, filtra enlaces `t.me` de spam antes de derivar descripcion o guardar captions y confirma tags antes de mostrar la vista previa.
- Subida directa en topic: si el mensaje cae en un topic asociado a categoria y el usuario tiene permiso, se indexa directamente.
- Soporte de `document`, `photo`, `video` y `audio`.
- Albums por `media_group_id` agrupados en una sola entrada mediante ventana corta en memoria.
- Admin: crear, mover, archivar y reactivar categorias; borrar logicamente entradas; ver, conceder y revocar acceso por categoria.
- Consola Textual `Storage gestor`: editar categorias/archivos existentes, mover categorias dentro de otras o a raiz, mover archivos a otra categoria, archivar/reactivar categorias y eliminar/restaurar archivos sin crear contenido nuevo.
- Panel web `/admin/storage`: navega por categorias/subcategorias como el flujo Telegram, muestra entradas con nombre como dato principal, metadatos y miniatura cuando hay imagen, abre un visor modal protegido para recorrer todas las imagenes de una entrada, gestiona entradas y categorias existentes con busqueda, cambio de nombre, categoria, tags y estado, movimiento logico de entradas/categorias y borrado logico/archivado con confirmacion; no permite crear contenido nuevo, que sigue entrando por Telegram.
- Permisos aplicados por recurso para `storage.entry.read` y `storage.entry.upload`.
- Auditoria de altas de categoria, cambios de estado, borrado logico y permisos.

Mejoras opcionales:

- Si no hay supergrupo por defecto configurado, o deja de ser valido, la seleccion guiada/manual de `storageChatId` y `storageThreadId` se mantiene como fallback.
- La consola puede cambiar el estado de entradas, incluyendo `missing_source`, pero no hay todavia un flujo Telegram dedicado para revisarlas.

Limitaciones aceptadas de la v1:

- No hay OCR, antivirus ni indexado de contenido interno del binario.
- El borrado es logico en PostgreSQL; no borra fisicamente mensajes de Telegram.
- Mover archivos desde la consola es un movimiento logico de categoria en PostgreSQL; no copia mensajes entre topics de Telegram.
- Si el proceso se reinicia durante la ventana de agrupacion de album, ese album puede requerir reenvio manual.

Documentacion relacionada:

- `improvements/storage_tui_management_plan.md` describe el alcance usado para el gestor TUI de Storage.
- `docs/superpowers/specs/2026-04-21-telegram-storage-design.md` contiene el diseño original.

## Impresión

Estado: `operativo`.

Implementado:

- Botón privado `Imprimir`, visible cuando un admin pone la feature en `Activar` o `Modo prueba` desde `Admin` -> `Impresora` y el usuario es admin o tiene el permiso global `printing.use`.
- Comando privado `/print` para iniciar el mismo flujo sin depender del teclado; socios aprobados sin `printing.use` reciben una denegación explicativa y no abren sesión de impresión.
- El estado operativo se persiste en `app_metadata` con efecto inmediato: `Activar`, `Desactivar` o `Modo prueba`. Al desactivar se bloquean nuevas sesiones y se oculta el botón, pero las sesiones ya iniciadas pueden terminar.
- Los admins gestionan el permiso desde `Admin` -> `Impresora` con `Conceder impresión`, `Revocar impresión` y `Accesos impresión`; las listas usan mensajes HTML con enlaces profundos, paginación por teclado y estadísticas por usuario de impresiones enviadas y páginas estimadas. Los admins siempre pueden imprimir aunque no tengan una asignación explícita.
- Entrada desde adjuntos Telegram: PDFs directos, documentos Office/OpenDocument convertibles a PDF mediante LibreOffice headless y fotos/imágenes JPG, PNG, WebP, TIFF o BMP normalizadas a PDF con ImageMagick.
- Entrada desde Storage: el detalle de entradas imprimibles muestra `Imprimir` cuando la feature está activa, el archivo tiene `telegramFileId`, el usuario puede leer la entrada de Storage y además es admin o tiene `printing.use`.
- El flujo rechaza de forma explicativa archivos que superan el límite de descarga del Bot API de Telegram en la nube (20 MB) antes de llamar a `getFile` cuando conoce el tamaño, salvo que el runtime tenga activado `telegram.localBotApi` para descargas grandes de impresión.
- Integración opcional con Bot API local sólo para impresión: `downloadFile` acepta `allowLocalBotApi`, el resto del bot sigue usando la ruta cloud por defecto, y si el intento local falla se registra el error y se usa el fallback cloud.
- El despliegue instala `gameclubtelegrambot-local-bot-api.service` como servicio systemd hermano del bot principal: `startup.sh` lo habilita/reinicia antes del bot cuando `telegram.localBotApi.enabled=true`, y lo detiene/deshabilita cuando está apagado.
- Cuando un archivo no puede descargarse por tamaño, el flujo cierra la sesión de impresión y restaura la navegación normal o el detalle de Storage, sin dejar un teclado de `Cancelar` huérfano.
- Cuando una descarga falla de forma transitoria (por ejemplo `fetch failed`), el flujo no propaga el error al chat: en adjuntos directos conserva el paso de archivo para reenviar el PDF sin reiniciar, y desde Storage restaura el detalle para reintentar con `Imprimir`.
- Para archivos dentro del límite de descarga, el flujo descarga el archivo temporalmente, normaliza Office a PDF si hace falta, inspecciona páginas con `pdfinfo`, pide páginas, páginas por hoja cuando hay más de una página seleccionada, copias, orientación `Vertical`/`Horizontal` y modo `Una cara`/`Doble cara` sólo si la cola CUPS confirma dúplex automático.
- Las imágenes se normalizan a PDF con ImageMagick después de elegir orientación: A4 vertical por defecto o A4 horizontal cuando el usuario lo selecciona.
- Si el documento normalizado sólo tiene una página, el flujo salta la pregunta de páginas y la de páginas por hoja, y pide directamente copias; si finalmente se imprime una sola página con una sola copia, también salta `Una cara`/`Doble cara` y usa una cara por defecto.
- La pregunta de páginas por hoja sólo aparece cuando aporta opciones útiles: `1`/`2` para dos o tres páginas seleccionadas, y `1`/`2`/`4` a partir de cuatro páginas seleccionadas; no ofrece `4` si sólo hay dos o tres páginas.
- Las preguntas del flujo muestran botones rápidos: `Todas` y `Cancelar` en páginas, `1`/`2`/`4` según corresponda en páginas por hoja, `1` y `Cancelar` en copias, `Vertical`/`Horizontal` en orientación, y `Cancelar` se mantiene visible en el resto de pasos.
- Confirmación extra si se seleccionan más de 10 páginas distintas y confirmación extra si se piden más de 10 copias.
- Confirmación final con archivo, páginas, páginas por hoja, copias, orientación, modo de caras, total estimado y cola CUPS antes de llamar a `lp`.
- En `Modo prueba`, el usuario recorre el flujo completo y el trabajo queda registrado con ID `test-mode`, pero el bot no llama a `lp` ni envía nada a CUPS.
- Al completar una impresión iniciada desde Storage, el bot restaura el teclado normal y vuelve a mostrar el detalle del mismo archivo para que el usuario pueda seguir usando sus acciones.
- La orientación se envía a CUPS con `orientation-requested=3` para vertical y `orientation-requested=4` para horizontal; las páginas por hoja se envían con `number-up=1`, `number-up=2` o `number-up=4`; los PDFs se envían además con `fit-to-page=true` y `media=A4` para escalar al área imprimible y evitar recortes de márgenes físicos.
- Doble cara sólo automática: cuando la cola CUPS confirma soporte, el usuario puede elegir doble cara y el trabajo se envía con `sides=two-sided-long-edge`; si CUPS no confirma el soporte, o no se puede leer el estado, el flujo oculta esa opción y usa `one-sided`.
- Historial persistente en `print_jobs` con usuario, origen, archivo, páginas, páginas por hoja, copias, total estimado de hojas físicas, modo, cola, estado, ID CUPS y error seguro.
- Menú admin `Impresora` con estado de cola, activación/desactivación, concesión/revocación de permisos de impresión, refresco e historial reciente.
- Las pruebas automatizadas usan runners falsos y no envían trabajos reales a la impresora física `HP-LaserJet-P2015-Series`.

Riesgos o pendientes:

- No se aceptan enlaces externos en la primera versión.
- La v1 de imágenes imprime una imagen como una página A4 ajustada y centrada; no hay todavía selección de orientación, márgenes, tamaño real, recorte, álbumes ni varias imágenes por página.
- Los documentos de Telegram superiores a 20 MB requieren activar y operar el servidor Bot API local en el PC del club; si no está activo, el bot los seguirá rechazando con explicación. Si falta el binario `telegram-bot-api`, el despliegue lo compila desde la fuente oficial de TDLib cuando la feature local está activada.
- No hay cancelación de trabajos ya enviados a CUPS desde el bot.
- La prueba real de papel/tóner queda para validación presencial en el club.

## Backups, consola operativa y panel web

Estado: `tecnico operativo`.

Implementado:

- Scripts `backup-cli.sh`, `backup-full.sh` y `restore-full.sh`.
- TUI `npm run backup:console`.
- Consola admin Textual `npm run admin:console` con gestor especifico de Storage.
- Panel web admin protegido por contraseña de elevación, sesión firmada, token CSRF en acciones POST y límite de intentos de login por IP.
- `/admin` abre en un dashboard de estado y métricas principales con toolbar operativa, métricas compactas y tarjetas de navegación por dominio; la operación queda separada en secciones: socios/usuarios en `/admin/users`, bienvenidas de grupo en `/admin/welcome`, actividades en `/admin/activities`, catálogo en `/admin/catalog`, Storage en `/admin/storage`, servicio/logs en `/admin/service`, configuración técnica y cambio de token en `/admin/config`, backups en `/admin/backups`, feedback en `/admin/feedback`, feeds en `/admin/news` y altas web en `/admin/member-signups`.
- Configuración de la web pública desde `/admin/web`, persistida en `app_metadata`, con marca CAWA Girona, temas allowlisted, enlaces destacados, contenido de `/club` y referencias a logo/hero/imagenes auxiliares. La shell pública/admin aplica una capa visual más rica con textura de fondo, cabecera con presencia, tarjetas métricas, formularios y tablas refinadas desde el CSS base compartido.
- La shell pública/admin usa los SVG de marca incluidos (`/brand/cawa_logo.svg` como logo por defecto y `/brand/cawa_casco.svg` como favicon), manteniendo los assets subidos desde `/admin/web` como override.
- Assets públicos de portada servidos desde `/assets/...`, guardados bajo `data/http-assets/` con nombre generado, validación de MIME/extensión y límite de 2 MiB.
- Restaurar o eliminar backups desde el panel web exige pantalla intermedia y confirmación textual (`RESTORE`/`DELETE`) además de CSRF.
- Detener el servicio, cambiar el token de Telegram y hacer borrados hard en recursos avanzados requieren confirmación textual (`STOP`, `CHANGE_TOKEN` o `DELETE`); el token pendiente no se reimprime en HTML.
- Secciones públicas iniciales: `/actividades` lista próximas actividades programadas agrupadas por dia, ordenadas por fecha y con mesa, juego enlazado, asistentes cuando existen, organizador, plazas en mesas abiertas y duracion legible cuando se ha configurado explicitamente; `/catalogo` lista artículos activos con búsqueda, filtro básico por tipo y paginación.
- Comando Telegram admin `/restart` para limpiar estado temporal y reiniciar el servicio bajo systemd.
- Deteccion/instalacion asistida de dependencias Debian como `pg_dump` y `psql`.
- Documentacion en `docs/backup-restore-recovery.md`.

Riesgos o pendientes:

- La restauracion sigue siendo una operacion sensible que requiere disciplina operativa; no hay simulacion obligatoria antes de restaurar.

## Analytics UX

Estado: `tecnico parcial`.

Implementado:

- Registro de eventos de menu en `audit_log`.
- CLI `npm run telegram:ux`.
- TUI `npm run telegram:ux:tui`.

Pendiente:

- Vistas de menus sin interaccion, breakdown por idioma, filtros avanzados, export JSON/CSV y medicion de abandono en flujos largos segun `analytics_improvements.md`.

## Pendientes transversales mas relevantes

| Pendiente | Area | Prioridad sugerida | Motivo |
| --- | --- | --- | --- |
| Revision de entradas `missing_source` | Storage | Media | El bot ya marca fuentes perdidas al fallar `copyMessage`; falta una vista admin especifica para revisarlas o restaurarlas. |
| UI de permisos general | Admin/permisos | Media | El motor existe, pero falta administracion transversal desde el bot. |
| `/news` con botones | Grupos de noticias | Baja | La secció està activa i operativa; revisar si cal refinament de copy o labels en futures iteracions. |
| Perfil de usuario / mi espacio | Usuario | Media | Evitaria que el usuario tenga que entrar por agenda, prestamos y compras por separado. |

## Tests relevantes por area

| Area | Tests principales |
| --- | --- |
| Runtime/menus | `src/telegram/runtime-boundary.test.ts`, `src/telegram/action-menu.test.ts`, `src/telegram/command-registry.test.ts` |
| Bienvenidas/nickname | `src/membership/welcome-template-store.test.ts`, `src/membership/access-flow.test.ts`, `src/telegram/runtime-boundary.test.ts`, `src/telegram/action-menu.test.ts` |
| Acceso | `src/membership/*.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Agenda | `src/telegram/schedule-flow.test.ts`, `src/schedule/schedule-catalog.test.ts`, `src/schedule/schedule-catalog-store.test.ts`, `src/schedule/*reminder*.test.ts` |
| Mesas | `src/telegram/table-admin-flow.test.ts`, `src/telegram/table-read-flow.test.ts` |
| Catalogo | `src/telegram/catalog-admin-flow.test.ts`, `src/telegram/catalog-read-flow.test.ts`, `src/catalog/*.test.ts` |
| Prestamos | `src/telegram/catalog-loan-flow.test.ts`, `src/catalog/catalog-loan-store.test.ts` |
| Compras conjuntas | `src/telegram/group-purchase-flow.test.ts`, `src/group-purchases/*.test.ts` |
| Rol / partidas de rol | `src/role-games/role-game-catalog.test.ts`, `src/role-games/role-game-catalog-store.test.ts`, `src/role-games/role-game-character-catalog.test.ts`, `src/role-games/role-game-character-store.test.ts`, `src/role-games/role-game-character-store.integration.test.ts`, `src/role-games/role-game-scheduler.test.ts`, `src/telegram/role-game-participants.test.ts`, `src/telegram/role-game-flow.test.ts`, `src/telegram/role-game-character-flow.test.ts`, `src/bootstrap/create-app.test.ts`, `src/telegram/action-menu.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Avisos | `src/telegram/notice-flow.test.ts`, `src/notices/*.test.ts`, `src/news/news-group-store.test.ts` |
| Storage | `src/telegram/storage-flow.test.ts`, `src/storage/*.test.ts` |
| Noticias | `src/telegram/news-group-flow.test.ts`, `src/news/news-group-store.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Operacion | `src/tui/*.test.ts`, `src/operations/*.test.ts`, `src/tray/*.test.ts` |
