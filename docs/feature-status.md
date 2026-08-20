# Estado real de features

Última revisión: 2026-08-18.

Este documento refleja lo que existe en el código actual, no solo lo que aparece en planes o specs. Los estados usados son:

- `operativo`: implementado en el bot, persistido si aplica y cubierto por tests relevantes.
- `parcial`: hay implementación usable, pero falta una parte importante de UX, operación o alcance.
- `pendiente`: está documentado o preparado en modelo/backlog, pero no hay flujo completo en el bot.
- `técnico`: capacidad de infraestructura u operación, no una feature visible para socios.

## Resumen ejecutivo

```text
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
| Feature                                      | Estado              | Lectura actual                                                                                                                        |
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
| Runtime, configuración y despliegue          | 🟢 Operativo        | Base TypeScript, PostgreSQL, Drizzle, bootstrap, long polling, reintentos Telegram, systemd/tray y backups.                           |
| Acceso, usuarios y admins                    | 🟢 Operativo        | Solicitud/aprobación/rechazo/revocación, autojoin por grupo, nickname, bienvenidas, avisos privados y alta web en `/alta`.            |
| Idioma, menús y ayuda                        | 🟢 Operativo        | `ca`, `es`, `en` + menú por rol/contexto, Avisos, LFG, Rol y ayuda contextual por sección activa.                                     |
| Asistente LLM de órdenes naturales           | 🟠 Parcial          | `/ask` y fallback privado; menciones IA en grupos/topics responden sólo por privado, sin mensajes públicos.                           |
| Mesas                                        | 🟢 Operativo        | Administración de mesas y consulta de tablas activas para socios.                                                                     |
| Equipamiento                                 | 🟢 Operativo        | Alta admin y reserva múltiple de equipamiento en actividades, con detalle y avisos de solapamiento.                                   |
| Agenda de actividades                        | 🟢 Operativo        | Creación Telegram/web con token, reservas de mesa/equipamiento, promoción, altas/bajas, conflictos y recordatorios.                  |
| Google Calendar                              | 🟢 Operativo        | Selección admin, acceso público/privado, sincronización Agenda → Google y enlace limpio desde grupos/topics.                          |
| Eventos del local                            | 🟢 Operativo        | Gestión admin de eventos con impacto directo en agenda y resumen diario, con progreso editable.                                       |
| Catálogo                                     | 🟢 Operativo        | CRUD, posiciones físicas fila/columna, búsqueda, media con Storage, BGG/Open Library/Wikipedia y progreso editable.                   |
| Préstamos                                    | 🟢 Operativo        | Acceso directo a Mis préstamos, recordatorios privados semanales, devolución directa, alta admin y dashboard de préstamos activos.  |
| Grupos de noticias                           | 🟢 Operativo        | `/news` por categoría para grupo completo o topic, incluido `public-events`; `/admin/news` resume feeds activos.                      |
| LFG / buscar grupo                           | 🟢 Operativo        | Anuncios persistentes de jugadores y grupos, gestión propia y publicación en feeds/topics específicos.                                |
| Feedback web y Telegram                      | 🟢 Operativo        | Formulario público y flujo privado voluntario con consentimiento, persistencia compartida y consulta admin.                           |
| Avisos                                       | 🟢 Operativo        | Socios y admins crean, ven, editan y archivan avisos con formato/adjuntos en destinos `/news avisos`.                                 |
| Compras conjuntas                            | 🟢 Operativo        | Crear/listar/unirse/confirmar, descripciones, `/news group-purchases`, participantes y recordatorios.                                 |
| Rol / partidas de rol                        | 🟢 Operativo        | Campañas/one-shots, personajes, sesiones, recurrencia, handouts internos e importación Notion revisada por DM.                        |
| Storage / Archivos                           | 🟢 Operativo        | Índice de adjuntos con categorías, permisos, búsquedas, cargas Telegram y gestión admin web/TUI sin creación web.                     |
| Impresión                                    | 🟢 Operativo        | Botón privado, estados admin, PDF/Office/imágenes desde adjunto o Storage, páginas/copias/caras e historial.                          |
| Generación de imágenes                       | 🟠 Parcial          | Flujo Codex `$imagegen` completo por DM y con permisos separados; la integración real con Codex y Telegram queda por verificar.       |
| Backups, operación y panel web               | 🟢 Operativo        | CLI/TUI de backup/restore, gestión Debian, dashboard web, Storage web, bienvenidas, temas y páginas públicas.                         |
| Analytics / UX                               | 🟡 Técnico parcial  | Eventos de menú en auditoría y reportes CLI/TUI; faltan vistas, filtros, exportación y medición de abandono.                          |
+----------------------------------------------+---------------------+---------------------------------------------------------------------------------------------------------------------------------------+
```


Leyenda: 🟢 operativo, 🟠 parcial, 🟡 técnico.

## Runtime y operación

Estado: `técnico operativo`.

Implementado:

- Arranque principal en `src/main.ts` y `src/main-program.ts`.
- Configuración runtime validada con `zod` y editor/wizard en `src/config/*` y `src/bootstrap/*`.
- PostgreSQL con Drizzle, schema central y migraciones en `src/infrastructure/database/schema.ts`.
- Long polling con `allowed_updates` limitado a `message` y `callback_query` en `src/telegram/runtime-boundary-support.ts`.
- Capa intermedia de reintentos para envíos y operaciones Telegram en `src/telegram/telegram-api-retry.ts`, usada desde el boundary runtime; respeta `retry_after` de Telegram sin recortarlo al máximo de backoff propio.
- Canario de salud de Telegram API: detecta fallos transitorios y mantiene estado degradado temporal para diagnóstico interno sin añadir avisos a las respuestas visibles del bot.
- El middleware global de Telegram responde los errores inesperados con el detalle exacto saneado para operador/usuario, en vez de ocultarlos tras un mensaje genérico.
- Scripts de operación, systemd, tray Debian y backups documentados en `README.md`, `docs/debian-service-operations.md`, `docs/debian-tray-operations.md` y `docs/backup-restore-recovery.md`.
- Herramientas `npm run codex:image` y `npm run codex:benchmark`, junto con `scripts/codex-cawa.sh`, para consultar imágenes y medir modelos Codex con el usuario operador; la lectura de portadas usa `gpt-5.4` y todas las traducciones del catálogo comparten `gpt-5.6-luna` con razonamiento `medium` y prompt de fidelidad estricta por defecto. Estas ayudas no sustituyen las fuentes de metadatos BGG/Open Library/Wikipedia.
- Panel HTTP integrado en el servicio del bot (`src/http/admin-http-server.ts`): portada pública en `/`, feedback público en `/feedback`, alta de socio en `/alta`, información del club en `/club`, actividades futuras en `/actividades`, catálogo público enriquecido en `/catalogo`, admin protegido en `/admin` y edición de marca/contenido/tema, enlaces destacados y assets de portada en `/admin/web`.
- Detección local de frustración o insultos en mensajes privados de socios aprobados y no bloqueados: usa sólo diccionarios y frases fijas en catalán, español e inglés, ofrece enviar feedback de forma voluntaria y lo guarda en el mismo registro visible desde `/admin/feedback`; no usa LLM ni interviene en flujos activos.
- El comando privado admin `/status` adjunta la copia canónica `docs/feature-status.md`; el despliegue sincroniza esa copia al directorio operativo mediante `./startup.sh`.
- El despliegue público usa Nginx como reverse proxy hacia `127.0.0.1:8787` con HTTPS de Let's Encrypt para `cawa.hopto.org`.

Riesgos o pendientes:

- La recepción de actualizaciones de Telegram usa long polling, no webhooks de Telegram. El servidor HTTP sí expone el webhook firmado de Notion descrito en la sección de Rol.
- `featureFlags` existe en configuración, pero la mayoría de features visibles no están realmente gateadas por flags.
- `/status` no tiene todavía un test focalizado que cubra el archivo ausente, la falta de `sendDocument` y el envío correcto del documento.

## Acceso, usuarios y admins

Estado: `operativo`.

Implementado:

- `/access` pide primero el nombre visible con el que el usuario quiere ser conocido en el bot; ese nickname se guarda en `users.display_name` y se usa en avisos y bienvenidas.
- Los socios aprobados tienen la acción "Cambiar nombre de usuario" en el teclado principal para actualizar su nombre visible sin depender del username de Telegram.
- `/access` crea solicitudes y soporta reintentos según estado del usuario.
- `/review_access`, `/approve`, `/reject` y callbacks inline resuelven solicitudes.
- `/manage_users` abre una pantalla de gestión: lista usuarios registrados con nombre enlazado al detalle, username clicable, estado y rol.
- El detalle de usuario resume identidad, estado, rol, préstamos activos, actividades futuras y actividades recientes.
- Desde el detalle, los admins pueden expulsar socios no admin con motivo, ascender socios a admin y eliminar rol admin sin revocar acceso de socio.
- La gestión de rol admin escribe auditoría en `user_permission_audit_log` y `audit_log`.
- `/elevate_admin` eleva a admin usando hash de password runtime.
- `/subscribe_requests` y `/unsubscribe_requests` permiten avisos privados de nuevas solicitudes.
- `/adminai {petición}` permite a un admin expresar en lenguaje natural la opción del bot que quiere abrir. Codex devuelve un plan estructurado con un único destino de allowlist; el bot muestra siempre explicación, lista numerada de acciones y botones inline `Aceptar`/`Cancelar`. Sólo tras aceptar se vuelve a comprobar el rol y el contexto, se registra la confirmación sin guardar el prompt literal y se abre el flujo guiado o comando local existente. No admite shell, SQL, HTTP, argumentos libres ni escrituras directas de la LLM.
- `/autojoin enabled` y `/autojoin disabled` permiten a admins activar por grupo el alta automática: cada usuario no bot que entre en un grupo con autojoin activado se crea como pendiente si hace falta, queda aprobado como miembro y recibe siempre una bienvenida de grupo si hay plantillas activas, aunque ya constase como aprobado; con autojoin desactivado, la entrada al grupo no aprueba ni envía bienvenida. Los usuarios bloqueados no se reactivan automáticamente.
- `/alta` registra solicitudes de alta desde la web en `member_signup_requests`, avisa por privado a admins aprobados y publica en grupos suscritos al feed `nuevos_miembros`.
- `/admin/member-signups` permite revisar desde el panel web las solicitudes de alta recibidas, su estado, el resumen de avisos enviados y marcar cada solicitud como contactada, aprobada, rechazada o pendiente.
- `/admin/welcome` permite a admins configurar plantillas aleatorias de bienvenida de grupo, con placeholder `$USERNAME`, GIF opcional mediante Telegram animation file ID, plantillas globales y plantillas específicas por Telegram user ID.
- Al aprobar una solicitud desde Telegram (`/approve` o callbacks de revisión), el bot no envía bienvenida privada ni publica plantillas en grupos. Las bienvenidas de grupo se envían sólo cuando Telegram informa de una entrada real al grupo y ese grupo tiene `/autojoin enabled`.
- El teclado privado inicial de admins mantiene las acciones diarias de socio y agrupa las herramientas administrativas tras el botón `Admin`; dentro de ese submenú está `Bienvenidas`, que lista las plantillas actuales con paginación por botones de teclado, pie visible `Mostrando X-Y de Z. Página A/B`, un enlace inline compacto junto a cada plantilla para abrir su detalle, acciones de detalle para previsualizar, editar texto, editar GIF/video, activar/pausar, eliminar y crear una bienvenida nueva directamente desde Telegram enviando el texto con formato Telegram conservado (negrita, cursiva, etc.) y después un GIF/video opcional como adjunto, aceptando animaciones Telegram, videos convertidos por el móvil y archivos `.gif`.
- En privado, los aliases secretos `Welcome`, `/welcome`, `Bienvenida` y `/bienvenida` envían al usuario una previsualización real de la bienvenida aleatoria que le tocaria, usando su nombre visible guardado; `/welcome 1` y `/bienvenida 1` fuerzan una plantilla concreta por posición visible.
- Las revocaciones notifican al usuario afectado y a admins suscritos.
- Persistencia y auditoría en `users`, `user_status_audit_log`, `user_permission_assignments` y `user_permission_audit_log`.

Riesgos o pendientes:

- No hay una UI general para conceder/revocar cualquier permiso global o por recurso. Hay flujos especificos para rol admin, revocacion de acceso, storage category access y permisos globales de impresión y generación de imágenes.

## Idioma, menús y ayuda

Estado: `operativo`.

Implementado:

- `/language` y flujo de idioma en privado/grupo.
- Menú principal dinámico por rol, estado, chat y sesión en `src/telegram/action-menu.ts`.
- El menú aprobado/admin muestra "LFG (buscar grupo)", "Rol", "Avisos" y una acción visible para cambiar el nombre mostrado por el bot; el menú raíz de admins añade un botón `Admin` que abre las herramientas administrativas sin mezclar solicitudes, usuarios, mesas admin y bienvenidas con las acciones diarias.
- `Inicio` y `/start` normal limpian cualquier sesión activa antes de reconstruir la portada, evitando dejar al usuario atrapado con un teclado de `/cancel`, y muestran hasta 3 avisos activos recientes.
- Ayuda contextual en `src/telegram/command-registry.ts` y sección activa gestionada desde `runtime-boundary-registration.ts`.
- Soporte visible para `ca`, `es` y `en`.

Riesgos o pendientes:

- Muchos flujos dependen de comparar texto localizado de botones. Cambios de copy pueden romper acciones si no se actualizan tests.

## Rol / partidas de rol

Estado: `operativo`.

Implementado:

- Botón privado `Rol` para socios aprobados y admins en el menú raíz, manteniendo herramientas administrativas dentro de `Admin`.
- Comandos `/rol` y `/role_games`, además del botón `Rol`, abren directamente `Mis partidas`; el teclado conserva `Partidas visibles` y `Crear partida` como acciones secundarias.
- Home con `Mis partidas`, `Partidas visibles`, `Crear partida` y `Cancelar` con rol danger.
- Listas read-only de partidas propias y visibles desde `RoleGameRepository`, con paginación estilo Telegram y deep links `role_game_<id>` al detalle.
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
- `Editar partida` inicia un flujo guiado cancelable para cambiar título, sistema, descripción, plazas, visibilidad, modo de entrada, aceptación, programación manual por jugadores, publicación Agenda por defecto y estado.
- `Cancelar partida` permite al GM principal y a los admins globales cancelar campañas y one-shots desde `Configurar`, con confirmación explícita. Conserva la partida y su historial, fija el estado `cancelled`, detiene la generación recurrente y la retira de las listas activas.
- `Eliminar partida` permite al GM principal y a los admins globales borrar definitivamente campañas y one-shots desde `Configurar`. Exige escribir el título exacto y una confirmación final; elimina personajes, solicitudes, adjuntos, materiales, categorías y participantes, marca como borradas las entradas Storage internas y cancela las sesiones Agenda vinculadas. La opción `Configurar` permanece disponible para propietarios de one-shots aunque no admitan recurrencia.
- `Invitar jugadores` mantiene el enlace `role_game_<id>` compartible y añade una lista paginada de socios aprobados con hasta 15 personas por página. Cada persona aparece como un deep link clicable en el cuerpo del mensaje, mientras el teclado queda reservado para paginación, salto directo de página y navegación; también se puede enviar su `@usuario`. GM, coorganizadores y admins pueden iniciar la invitación, el bot crea una invitación pendiente y escribe al destinatario por privado con botones `Aceptar` y `Denegar`. Sólo el destinatario puede responder, la aceptación vuelve a comprobar el aforo de forma atómica y un fallo al enviar el mensaje retira la invitación pendiente.
- Al crear una campaña o un one-shot, el bot pregunta explícitamente si se quiere publicar ahora en Agenda. `Crear sin publicar en Agenda` guarda la partida sin pedir fecha ni recurrencia y sin escribir actividades; `Configurar y publicar en Agenda` abre la planificación correspondiente y la confirmación final vuelve a distinguir de forma inequívoca entre crear sin publicar y crear publicando.
- Los one-shots sólo piden fecha y hora cuando se ha elegido publicar, muestran una confirmación de Agenda con todos los datos exactos de la actividad y sólo después generan una primera sesión en `schedule_events` enlazada con `role_game_sessions`. Si se crean sin publicar, el GM, los coorganizadores o un admin pueden programar su sesión más adelante desde la partida.
- Las sesiones iniciales de one-shots y las sesiones manuales creadas desde Rol ejecutan las mismas notificaciones posteriores que una actividad creada desde Agenda: actualizan los snapshots de los grupos/topics suscritos a `events` y, cuando corresponde, a `public-events`.
- `Admin` -> `Rol automático` muestra la configuración efectiva y permite activar o desactivar en caliente la creación automática de actividades recurrentes, sin reiniciar el bot. El flag global persiste apagado por defecto; activarlo desde esta pantalla Admin exige una confirmación explícita que informa del horizonte vigente. Los aliases privados `/role_auto_schedule enabled` y `/role_auto_schedule disabled` se mantienen como acceso técnico directo. Mientras el flag está apagado el worker no crea sesiones recurrentes; una creación nueva sólo escribe su lote inicial si el usuario elige explícitamente `Configurar y publicar en Agenda` y confirma el resumen exacto.
- La misma pantalla administra el horizonte máximo de creación automática entre 1 y 52 semanas, con 2 semanas por defecto y opciones rápidas además de entrada numérica. El worker relee flag y horizonte en cada ciclo, y las previsualizaciones y confirmaciones de Rol aplican el valor actual antes de escribir en Agenda.
- Las campañas activas muestran `Programar siguiente sesión` a GM/coorganizadores/admins y a jugadores confirmados cuando la partida permite programación manual por jugadores, incluso si tienen recurrencia configurada. La acción crea o sustituye exclusivamente la próxima sesión: si ya existe, enseña su enlace y exige confirmar que se reemplaza; las sesiones posteriores se conservan. Tras introducir fecha y hora, el bot todavía no escribe nada: muestra nombre, día completo, franja horaria, duración, tipo, visibilidad, plazas, mesa y descripción, y exige pulsar `Confirmar`; `Cancelar` deja Agenda intacta.
- Cuando se elige publicar una campaña al crearla, la periodicidad ofrece `Sin días fijos`, `1` y `2` en el teclado y también acepta un número de semanas. `Sin días fijos` vuelve al alta sin publicación y activa exclusivamente la programación manual; una frecuencia numérica pide el día de la semana mediante siete botones y después obliga a elegir la siguiente partida entre las cuatro próximas fechas coincidentes antes de pedir hora y ventana futura.
- Las campañas pueden reconfigurar esa periodicidad desde `Configurar recurrencia`. Con la programación automática activada, antes de guardar una planificación sin escrituras descuenta las sesiones futuras ya existentes, pregunta si se quieren escribir exactamente X actividades y enumera todos sus días y horas junto con los datos comunes completos. Al confirmar vuelve a calcular la planificación y, si cambia el lote previsto —por ejemplo por flag u horizonte—, obliga a revisar de nuevo; sólo una confirmación vigente crea el lote mostrado. Con el flag apagado se guarda la regla sin crear actividades. La regla recurrente persiste la fecha elegida como anclaje `startsOn`, para que el worker mantenga la cadencia sin inventar la primera ocurrencia. Una ocurrencia cancelada o con enlace conservado pero evento ausente consume su posición dentro de la ventana configurada: no se recrea ni provoca que el worker prolongue la serie con otra actividad más lejana.
- Las sesiones de rol reutilizan Agenda: crean eventos con `createScheduleEvent`, enlazan `role_game_sessions`, apuntan automáticamente a jugadores confirmados hasta la capacidad disponible cuando la partida lo configura y enlazan el recibo a `schedule_event_<id>`. La creación recurrente se serializa por partida y fecha, vuelve a comprobar el enlace antes de escribir y cuenta sólo creaciones nuevas; además, la base de datos impide dos enlaces para una misma ocurrencia. La migración de esta garantía conserva preferentemente la actividad activa de cualquier duplicado histórico, cancela las actividades sobrantes y retira sus enlaces duplicados.
- GM principal y admins gestionan solicitudes, listas de espera, jugadores y coorganizadores; los coorganizadores conservan la resolución operativa de solicitudes y el envío de invitaciones directas. Los cambios de estado o rol comparan el estado de origen y cualquier transición que ocupe una plaza confirma capacidad de forma atómica.
- Participantes activos e historial separado se muestran con identidad visible, rol del GM principal, estado, fecha relevante y paginación. Cada fila enlaza al detalle del participante mediante `role_game_participant_<game>_<member>_<vista>_<página>` y el teclado queda reservado para historial, paginación y navegación; nadie puede promocionarse a sí mismo y los estados históricos no permiten reactivación ni nuevas solicitudes desde Telegram.
- La solicitud de plaza comparte la misma validación de capacidad entre visibilidad y ejecución. Los one-shots públicos con política `members_and_external` se pueden abrir desde `/start role_game_<id>` por usuarios no aprobados y permiten solicitar plaza externa sin aprobar automáticamente la membresía del usuario.
- Un admin global que consulte una partida privada o de sólo invitación sin ser todavía participante ve inicialmente la ficha normal de jugador, puede solicitar plaza y dispone de `Abrir como administrador` para activar temporalmente las herramientas administrativas de esa partida. La solicitud no usa privilegios para saltarse el aforo ni la revisión configurada por el GM y queda registrada como miembro interno pendiente o confirmado según la política de aceptación de la partida.
- Infraestructura Storage para handouts internos con propósito `role_game_handouts`, oculto de Storage normal, `/storage`, busquedas, web/TUI Storage y busquedas LLM.
- Los managers pueden subir uno o varios adjuntos como un único pack desde la ficha de partida. El bot recoge los archivos mediante teclado persistente, pide obligatoriamente el nombre con una sugerencia basada en el caption o el archivo y sólo entonces los copia con progreso editable. Si todavía no existe la categoría interna de handouts, crea automáticamente su topic y categoría en el supergrupo Storage por defecto antes de guardar el pack como un único `role_game_materials` `gm_only`, sin exponer `storage_entry_<id>`. Al completar la subida conserva la sesión en `Materiales`, de modo que `Volver a la partida` mantiene la navegación de Rol y no cae en el fallback de IA.
- `Materiales` lista handouts subidos desde Rol con paginación mediante teclado de respuesta persistente cuando corresponde, enlazando sólo `role_material_<id>` y sin abrir acceso a Storage.
- Los handouts se organizan en categorías y subcategorías jerárquicas privadas de cada partida, sin reutilizar ni mostrar el árbol global de Storage, con navegación mediante enlaces de texto y paginación conjunta de carpetas y materiales. Los uploads nuevos se guardan en la categoría abierta; el contenido anterior permanece en la raíz sin categoría y los managers pueden moverlo después a cualquier categoría de esa misma partida.
- Al abrir un handout, el bot envía directamente todos sus adjuntos en orden para que el usuario pueda identificar el contenido y mantiene sus acciones en el teclado de respuesta. Los managers pueden enviarlo sólo esta vez, enviarlo y revelarlo, revelarlo sin envío o eliminarlo tras una confirmación explícita; además pueden elegir a un jugador confirmado concreto para enviárselo o revelárselo en privado, sin cambiar la visibilidad global ni conceder acceso al resto. La revelación individual queda registrada y permite únicamente al destinatario confirmado volver a abrir `role_material_<id>`. También pueden ejecutar las acciones de envío y revelado sobre una categoría completa, incluyendo recursivamente todas sus subcategorías, con progreso editable y resumen agregado. Al eliminar un handout se retiran su historial de entregas y su referencia de Rol, y la entrada interna se marca como eliminada en Storage. El bot registra `role_game_material_deliveries`, resume fallos parciales y aplica permisos de Rol a `role_material_<id>`.
- Notion se integra exclusivamente por campaña como fuente interna de sólo lectura: cada DM vincula su propio token, que se cifra localmente y cuyo mensaje Telegram se redacta en logs e intenta borrar tras guardarlo. El GM principal, coorganizadores y admins pueden vincular una página raíz, abrir `Navegar contenido` para refrescar y recorrer sus subpáginas jerárquicas con enlaces pulsables y paginación; el teclado queda para importar la página abierta y navegar. También pueden usar la URL/ID como alternativa. La importación se convierte primero en un handout `gm_only` almacenado en el topic interno; las entregas a jugadores siguen usando las acciones y auditoría habituales de Materiales.
- El endpoint público secreto `/webhooks/notion/<secreto>` valida el HMAC SHA-256 sobre el cuerpo recibido, guarda el token de verificación sin registrarlo en logs y persiste cada evento de manera idempotente. Un cambio, incluida una página nueva que aún no conste en el índice, genera cola para cada campaña afectada y avisa a sus GM de forma best-effort; nunca reenvía material automáticamente. El navegador marca las páginas cambiadas y al reimportarlas se cierran sus cambios pendientes; también se pueden descartar explícitamente. Guía operativa: `docs/role-game-notion.md`.

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
- El fallback LLM reconoce insultos dirigidos al bot y abre el consentimiento de feedback en privado. Desde una mención de grupo/topic interpretada como feedback, el aviso también se entrega sólo por privado; no confunde insultos entre personas con feedback del bot.
- Las menciones iniciales con texto en grupos/topics activan la IA mediante `GAMECLUB_LLM_COMMANDS_GROUP_INTERACTIONS_ENABLED=true`, sin progreso, errores ni respuestas públicas. Si Codex interpreta el comando, el resultado llega sólo por mensaje directo al autor; si falla la interpretación o el envío privado, el grupo no recibe ningún mensaje. Los replies de grupo/topic no activan esta entrada. `/ask`, el botón, las sesiones y el fallback privado continúan disponibles.
- Una mención inicial sin texto (`@bot`) no invoca la LLM: reabre por privado el inicio y menú raíz para quien ya contactó con el bot; para una persona nueva explica en el grupo cómo abrir el privado con `/start`.
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
- Timeout LLM por defecto ampliado a 60s para reducir cortes durante búsquedas con refinado semántico; los timeouts se comunican con mensaje específico al usuario.
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

## Equipamiento

Estado: `operativo`.

Implementado:

- `Inicio → Admin → Equipamiento` y `/equipment` permiten a los admins crear, listar, editar y desactivar elementos reservables sin alterar el catálogo de mesas.
- El flujo completo de creación y edición de Agenda permite seleccionar varios elementos activos; el modo simple crea la actividad sin equipamiento.
- El resumen final del flujo estándar mantiene `Equipamiento` como acción visible para añadir, retirar o revisar la selección antes de guardar.
- El formulario web personal de creación ofrece la misma selección múltiple y vuelve a validar que cada elemento continúe activo antes de guardar.
- Las reservas se persisten por actividad y se muestran por nombre en el resumen, detalle y listados de Agenda.
- Si dos actividades coinciden en horario y comparten mesa o al menos un elemento, Telegram y el formulario web muestran el aviso de conflicto antes de guardar.

Riesgos o pendientes:

- Como ocurre con las mesas, un solapamiento se avisa pero no se bloquea automáticamente.
- No se crean elementos iniciales en la migración; los admins dan de alta únicamente el equipamiento real del club.

## Agenda de actividades

Estado: `operativo`.

Integración Google Calendar:

- `Inicio → Admin → Calendar Google` y `/google_calendar` permiten seleccionar el calendario asociado, alternar su accesibilidad pública/privada (privado por defecto) e iniciar o detener la sincronización automática.
- La Agenda conserva la autoridad: las altas, ediciones y cancelaciones se envían a Google Calendar, mientras que los cambios manuales en Google no se importan al bot.
- Al iniciar la sincronización se reconcilian las actividades futuras existentes; un worker cada cinco minutos reintenta la sincronización de actividades futuras y cancelaciones recientes.
- En grupos y topics, `@cawa_management_bot calendar` publica el enlace configurado en el mismo destino e intenta borrar el trigger si Telegram autoriza al bot. Un calendario privado sigue requiriendo que Google haya concedido acceso al socio o grupo.
- La preparación de cuenta de servicio, permisos y secreto runtime está documentada en `docs/google-calendar.md`.

Implementado:

- `/schedule` con crear, crear en modo simple, listar, editar, cancelar, detalle por deep link, unirse y salir. El botón `Crear (simple)` pide título, fecha, hora y número de plazas, y crea directamente una actividad de 180 min, mesa abierta sólo para socios, 0 ocupadas, sin mesa, sin equipamiento y sin descripción. El flujo completo muestra al elegir fecha la agenda de ese día con el mismo formato de publicación y, tras la hora, propone sin duración, mesa cerrada y sin mesa; el resumen permite cambiar rápidamente duración, tipo, mesa y equipamiento reservado.
- Si la creación web está activa, al iniciar el flujo completo Telegram ofrece además un enlace personal de un solo uso, con token aleatorio almacenado sólo como hash y caducidad de 30 minutos. La ruta no se anuncia en la navegación pública y vuelve a comprobar que el usuario siga aprobado antes de mostrar o guardar el formulario.
- El formulario web responsive permite completar título, descripción, fecha mediante calendario, hora, duración, mesa, varios elementos de equipamiento, tipo abierto/cerrado, visibilidad pública, aforo y plazas ya ocupadas. Muestra la Agenda del día y, justo antes de guardar, destaca los cruces de la mesa o equipamiento seleccionados con una alerta roja que identifica cada actividad y enlaza a su persona organizadora, igual que el resumen preventivo de Telegram; la validación al enviar vuelve a comprobar contra los catálogos activos y la creación conserva el usuario de Telegram como organizador, auditoría, sincronización Google Calendar, avisos de conflicto, snapshots y confirmación privada.
- El detalle de actividad respeta el idioma activo y muestra la persona creadora como enlace a su perfil de Telegram. En actividades abiertas presenta los asistentes como una lista de perfiles y cada plaza ocupada inicialmente como `Reservado`; la persona creadora y los admins ven además el enlace `Asignar`, que abre un selector paginado de socios aprobados. La asignación convierte de forma atómica una reserva genérica en un participante real —sin alterar la ocupación total—, registra auditoría y avisa al socio por privado.
- La persona creadora y los admins pueden promocionar una actividad desde su detalle con un mensaje personalizado opcional. La promoción puntual usa el feed independiente y sin alta por defecto `promotions` (`promociones`/`promocions`), sin reutilizar el destino automático de `events` o `public-events`. Un admin registra uno a uno cada destino exacto desde el privado del bot con `/promociones suscribir <enlace t.me/c> [nombre visible]` o lo retira con `/promociones desuscribir <enlace>`; `/promociones suscribir default <enlace> [nombre visible]` lo convierte en el único preferido. El nombre opcional admite espacios, se conserva al volver a suscribir sin nombre y sustituye al fallback técnico del topic tanto en la confirmación como en el selector. Esto permite configurar `General` o un topic mediante el enlace sin publicar comandos en el grupo: en foros, un enlace directo terminado en `/1` representa `General`, uno terminado por ejemplo en `/5` representa el topic 5 y una ruta `/5/<mensaje>` conserva ese mismo topic. Como alternativa operativa, se mantienen `/news suscribir promociones` y su variante `default` desde el propio destino. Cambiar el preferido no elimina las demás suscripciones. En supergrupos con foro, el destino sin topic se identifica expresamente como `General`. Si sólo existe un destino se selecciona automáticamente; si hay varios, el preferido aparece primero y el resto se ordena alfabéticamente por el nombre visible configurado o el fallback que devuelve el bot. Si no hay ninguno se detiene el flujo y se indica que un admin debe configurar la suscripción de promociones. La publicación incluye plazas libres y un botón directo para abrir la actividad y apuntarse.
- Soporte de fecha, hora, duración, mesa opcional, equipamiento múltiple opcional, juego de catálogo enlazado cuando se crea desde su detalle, modo abierto/cerrado, visibilidad pública sólo para mesas abiertas, plazas iniciales ocupadas, capacidad y mensaje extra opcional con adjuntos para detalles.
- Las actividades públicas siguen apareciendo en las listas internas normales y además permiten que usuarios de Telegram no aprobados abran el deep link de detalle y se apunten, sin convertirlos en socios del club.
- Si el usuario escribe solo la hora de inicio, el bot pasa a un paso especifico de minutos con botones rapidos (`:00`, `:15`, `:30`, `:45`) y copy propio.
- Preferencia de recordatorio al apuntarse y worker persistente de recordatorios.
- Avisos de conflicto y capacidad al crear/editar. Al seleccionar una mesa o equipamiento durante la creación, el resumen avisa antes de guardar de cualquier solapamiento que comparta al menos un recurso, muestra las actividades con el formato de Agenda y enlaza al organizador para escribirle por privado. Una actividad sin recursos compartidos no genera avisos de conflicto.
- Integración con eventos del local para mostrar impacto.
- Listados resumidos y snapshots de grupo con descripciones de actividad limitadas a 30 caracteres, incluidos los puntos suspensivos cuando se recortan; sólo en ese caso añaden tras ellos un enlace localizado `Ver descripción` que abre la ficha completa. El enlace `Ver detalles` aparece únicamente cuando la actividad tiene mensaje extra guardado; en ese caso no imprimen la descripción en línea y el deep link reenvía el mensaje original al usuario.
- Publicación de snapshot a destinos de noticias suscritos; los feeds marcados por defecto como `events` llegan a todos los grupos de news habilitados salvo que ese feed tenga un destino explícito, incluido un topic. El feed separado `public-events` no se activa por defecto y publica sólo la agenda filtrada a actividades públicas. El bot recuerda el último snapshot por grupo/topic/categoría y borra el anterior tras publicar uno nuevo; si Telegram rechaza el borrado por antigüedad o permisos, edita el mensaje anterior a puntos suspensivos para que no queden dos calendarios largos visibles.

Riesgos o pendientes:

- No bloquea solapes; el comportamiento real es avisar y permitir continuar.
- Los recordatorios dependen del worker interno y de `notifications.defaults.eventRemindersEnabled`.

## Eventos del local

Estado: `operativo`.

Implementado:

- `/venue_events` para admins con crear, listar, editar y cancelar.
- Soporta eventos de día completo o con horario, ocupación parcial/total e impacto bajo/medio/alto; los avisos privados por impacto se envían con un mensaje de progreso editable para el admin.
- Impacto usado por agenda y resumen `Hoy en el club`.

Riesgos o pendientes:

- No hay gestión desde grupos; es flujo privado admin.

## Catálogo

Estado: `operativo`.

Implementado:

- `/catalog` para crear, listar, buscar, inspeccionar, editar y desactivar items.
- `/catalog_bulk` y el botón de menú "Añadir múltiples" permiten importar varios items en lote en background (separados por coma) con progreso editable y resumen final. La opción admin `/catalog_photo_bulk` / "Foto de la biblioteca" acepta una foto panorámica de las estanterías y usa visión Codex con criterio conservador: sólo admite títulos completos transcritos de forma clara y respaldados por el mismo texto visible, sin completar lecturas parciales por el arte, el contexto o conocimiento previo. La lista interna queda deduplicada y se muestra antes del alta; el admin puede editarla —un juego por línea o separado por comas—, repetir la foto o confirmarla y reutilizar entonces el alta secuencial. Antes de crear cada item se comprueba tanto el nombre leído como el título y el ID canónicos devueltos por BGG para no duplicar juegos ya catalogados. Cuando BGG devuelve varias coincidencias, cada candidato con ID aparece enlazado a su ficha de BoardGameGeek para poder identificar visualmente la edición correcta.
- La opción admin `/catalog_pending` / "Juegos pendientes de añadir" conserva en PostgreSQL todos los títulos confirmados desde fotos que no se hayan podido añadir. El listado aclara que acumula lecturas de fotos anteriores, está paginado y enlaza cada fila a un detalle con la fecha de primera detección, el último resultado, número de detecciones e intentos y candidatos BGG clicables. Las detecciones nuevas conservan además la referencia al mensaje Telegram de origen para que un admin pueda volver a mostrar la foto original desde el detalle; las entradas históricas anteriores a esta mejora no disponen de esa referencia. Desde ahí también se puede corregir el nombre y reintentar, pegar una URL directa de una ficha BGG para importar exactamente su ID, reutilizar el nombre detectado o eliminar la entrada con confirmación. Si el nuevo nombre tampoco resuelve el alta, queda guardado para el siguiente intento. Un reintento que crea el juego o comprueba que ya existía retira automáticamente la entrada, y el listado limpia coincidencias exactas que ya estén activas en el catálogo.
- Tipos: juegos de mesa, expansiones, libros, libros RPG y accesorios.
- Familias y grupos permanecen en el modelo y conservan los datos históricos, pero su interfaz está desactivada de forma centralizada: no aparecen en Telegram, catálogo público, catálogo web ni panel admin, y las ediciones mantienen silenciosamente las asignaciones existentes. Pueden reactivarse en el futuro sin migración de datos.
- Campos principales: título, original, descripción, idioma, editorial, año, jugadores, edad, duración, posición física, referencias externas y metadata.
- La posición física es opcional y usa códigos normalizados de fila y columna (`A1`, `B12`, etc.). Desde `Posición`, el bot permite seleccionar la fila `A-Z` y una columna común `1-20`, escribir cualquier columna positiva admitida o introducir el código completo; también permite retirar una asignación existente. La base de datos valida el formato y conserva las posiciones durante autocorrecciones e importaciones posteriores.
- Los listados y resultados del catálogo muestran `Posición A1` entre el tipo y la disponibilidad o préstamo únicamente en los ítems que tengan una posición asignada; los demás conservan la fila compacta anterior.
- Propietario opcional por item: un usuario puede asignarse como propietario desde el detalle; los admins pueden asignar otro usuario con selector paginado y quitar el propietario. El detalle muestra el nombre enlazado.
- El menú privado `Admin` ofrece `Catálogo web`: genera un enlace personal válido durante 1 hora y reutilizable durante toda su vigencia. Ese modo web vuelve a comprobar que el usuario siga siendo admin en cada petición, permite buscar y paginar el catálogo, editar los datos principales de cada juego y asignar o retirar el propietario mediante un selector de socios aprobados; la ficha de edición muestra la carátula actual y permite traducir y guardar automáticamente sólo la descripción mediante una acción dedicada, sin necesitar después `Guardar cambios`. Familias y grupos no se muestran ni se modifican desde este editor. Desde cada editor puede cargar datos BGG cambiando libremente el texto de búsqueda, viendo la lista completa de coincidencias con su carátula, pegando una URL exacta y comparando cada edición física por carátula, idioma, editorial, año y código de producto antes de aplicar los datos; la ficha general se distingue explícitamente de las versiones físicas y, al guardar, la descripción se traduce automáticamente al castellano con el mismo servicio y fallback que usa el bot. Tanto la traducción manual como la aplicación de BGG muestran un bloqueo de espera accesible con indicador circular y la fase actual mientras dura la petición. Las escrituras quedan auditadas.
- Media por URL con tipo `image`, `link` o `document`.
- Los admins pueden añadir imagen a un item existente desde el detalle usando URL o adjunto Telegram.
- Los admins pueden autocorregir datos de juegos/expansiones y libros desde el detalle: el bot reconsulta BGG/Open Library con el título o ID disponible, si BGG devuelve varias coincidencias muestra opciones para elegir manualmente, intenta traducir al castellano las descripciones BGG cuando el bot está en español usando DeepL si está configurado y Codex como fallback, actualiza campos, limpia referencias externas/metadata visibles, edita un mensaje de progreso con duración por paso (API, traducción, guardado, descarga/subida de portada y detalle) y reporta si la portada se ha importado, ya existía o no estaba disponible. También pueden traducir solo la descripción actual del item sin tocar el resto de datos usando progreso editable.
- El detalle admin de juegos/expansiones avisa al final cuando detecta una referencia BGG antigua sin metadatos modernos de rating, peso o jugadores recomendados, con enlace y boton de teclado para una importación BGG rápida que actualiza solo metadata sin traducir descripción ni importar portada; tras esa importación rápida, el detalle actualizado enlaza el juego pendiente anterior y siguiente para revisar la cola con menos pasos. El comando privado secreto de admins `/update_bgg` y el boton `Actualizar BGG` del submenu Admin recorren todos los juegos/expansiones activos, aplican esa importación rápida solo a los que la necesitan y mantienen un mensaje editable con barra de progreso y resumen final.
- Las imágenes reales del catálogo se guardan como entradas de Storage en una categoría interna `catalog_media`, oculta de la navegación normal de `/storage`.
- La media principal de un item es la primera imagen por `sortOrder`, usando `0` como portada.
- Al abrir el detalle de un item, el bot intenta mostrar primero la portada principal y después una ficha resumida con breadcrumbs, título, posición física si existe, propietario, disponibilidad, prestatario, jugadores, duración y enlace "Ver detalles" a la ficha completa.
- Las acciones del detalle de item se muestran en teclado de respuesta persistente para mantener libres los enlaces HTML dentro del mensaje. La ficha principal prioriza navegación, actividad, préstamo propio y `Mis préstamos`; para los admins agrupa edición, autocorrección/BGG, propietario, media, registro de préstamos y eliminación tras un único botón `Administración`, con retorno al detalle. El alias antiguo `Ver préstamos` sigue aceptándose como entrada compatible, pero ya no se muestra junto a `Mis préstamos`. Los detalles de lectura, préstamo y administración mantienen siempre `Inicio` y `Ayuda` al final del teclado para poder salir del contexto.
- En el alta de juegos/libros, el paso de nombre acepta una foto o documento de imagen de la portada; Codex sugiere el título y, si se crea el item, el bot pregunta si se guarda esa portada como imagen principal.
- `/catalog_search` como consulta para usuarios aprobados.
- Los botones de acción con texto natural usan nombres específicos por módulo en catalán, español e inglés: `Cerca al catàleg`/`Búsqueda en catálogo`/`Search catalog` y `Cerca a l'emmagatzematge`/`Búsqueda en almacenamiento`/`Search storage`, entre otros. El dispatcher deja siempre la búsqueda de Catálogo en su flujo incluso si existe una búsqueda activa de Storage; al volver desde el detalle de un ítem mantiene una sesión de navegación limpia. Mientras el usuario siga en el menú, una lista o los resultados del catálogo, cualquier texto libre se interpreta como una nueva búsqueda y los botones conocidos conservan su acción normal. Las etiquetas contextuales y esas transiciones se prueban en regresión.
- Vista de lectura con indice por rangos de tres iniciales: cada bloque muestra total de articulos y desglose por juegos de mesa, libros y accesorios, con enlaces normales `t.me?...start=` en el texto; los grupos internos no aparecen en la navegación principal.
- Vista pública `/catalogo` con búsqueda por título/original/editorial, filtros por tipo, número de jugadores y disponibilidad, paginación, agrupacion por inicial, tarjetas con portada, descripción, posición física, propietario, disponibilidad/préstamo y datos principales, detalle publico por item con descripción completa y enlace a BoardGameGeek cuando el item conserva referencia BGG. Las familias y grupos internos no se exponen.
- Creación de actividad desde item del catálogo y aviso si el item está prestado.
- Los avisos de préstamo y devolución se guardan en una cola persistente y se agrupan por grupo/topic en un solo mensaje de texto tras 5 minutos sin nuevos movimientos; cada evento nuevo reinicia la espera del lote completo.

Integraciones reales:

- Juegos de mesa: BGG es la fuente principal cuando `bgg.apiKey` está configurada, con Wikipedia como fallback operativo.
- Libros y RPG: lookup HTTP hacia Open Library desde `catalog-lookup-service`, incluyendo portada cuando Open Library expone `cover_i`, `cover_edition_key` o ISBN utilizable.
- BoardGameGeek: importación individual, autocorreccion desde detalle y coleccion operativas; los campos opcionales que la API representa con `0` —como una duración no informada— se guardan como ausentes para no bloquear el alta; la importación de coleccion usa progreso editable durante la reconciliacion y, cuando BGG devuelve portada, el bot descarga la `imageUrl`/`coverUrl` y la sube a Storage como portada. El fallback Codex de traducción trata la descripción como datos JSON y exige fidelidad frase a frase para evitar omisiones, instrucciones embebidas y contenido añadido.
- Open Library: cuando devuelve portada, el alta intenta guardarla como portada.
- Codex: se usa para leer el título visible desde una portada, detectar todas las cajas legibles de una foto general de la biblioteca y como fallback de traducción; las fotos de biblioteca se descargan a un directorio temporal que permite su lectura al usuario operador `cawa` y se elimina tras el análisis. La descarga de archivos Telegram usa la ruta compatible con Bot API local cuando está habilitada y reintenta fallos transitorios de red o respuestas 5xx antes de informar de error. Los metadatos completos siguen viniendo de APIs catalogadas como BGG/Open Library/Wikipedia.
- Los resúmenes de revisión tras importar desde BGG/Wikipedia acotan la descripción y los metadatos extensos para respetar el límite de mensajes de Telegram sin perder los datos completos guardados en el catálogo.
- La frontera de salida de Telegram sanea caracteres de control y protege globalmente los límites: divide mensajes largos preservando HTML y deja el teclado en el último fragmento; las ediciones y captions se acotan con HTML válido y un warning estructurado.

Riesgos o pendientes:

- El nombre historico `wikipedia-boardgame-import-service.ts` mezcla Wikipedia, Open Library y BGG collection, lo que puede confundir mantenimiento.
- La importación automática de imágenes externas es best-effort y muestra progreso editable cuando guarda media en Storage: si Telegram no acepta la URL o no hay Storage por defecto configurado, el item se crea igual.

## Préstamos

Estado: `operativo`.

Implementado:

- Crear un préstamo propio desde los botones del detalle/listado de catálogo.
- Registrar como admin un préstamo para otro socio aprobado: selector paginado, resumen de confirmación y persistencia del admin que hizo el alta.
- Devolver préstamo desde botones, visible solo para admins, quien tiene el item prestado o quien registro el préstamo.
- Consultar los préstamos activos propios desde `Mis préstamos`, accesible directamente en el menú de catálogo y desde el detalle de cualquier item, con devolución directa.
- Consultar todos los préstamos activos desde el dashboard admin separado `Préstamos activos`, accesible por `/loan_admin` y por el menú de catálogo, con item y prestatario enlazados, fecha prevista y estado vencido.
- Editar notas y fecha prevista de devolución.
- Enviar un recordatorio privado cada 7 días desde el alta mientras el préstamo siga activo, aunque no tenga fecha prevista, con botón `Ya lo he devuelto` para cerrarlo directamente.
- Encolar de forma persistente los eventos de préstamo/devolución y publicarlos por categoría en un único mensaje por grupo/topic cuando hayan pasado 5 minutos desde el último movimiento; cada alta o devolución reinicia el contador, los items mantienen su enlace al detalle y la confirmación privada explica la espera.
- Restriccion persistente de un préstamo activo por item.

Pendiente:

- Ninguna bloquejadora.

## Grupos de noticias

Estado: `operativo`.

Implementado:

- `/news status`, `/news enable`, `/news disable`, `/news subscribe <categoria>` y `/news unsubscribe <categoria>` en grupos y supergrupos con topics.
- Persistencia de grupos habilitados y suscripciones por categoría + destino (`chat_id` completo o `message_thread_id` concreto).
- `/news activar` dentro de un topic habilita el grupo y suscribe el feed de agenda (`events`) a ese topic para evitar que las actualizaciones de calendario caigan al general.
- Teclat inline de `/news` con `activar/desactivar`, `subscriure`, `desubscriure`, `refresh` y estado actual.
- Las respuestas administrativas de `/news` confirman feed y destino por nombre de grupo cuando Telegram lo proporciona, y se borran automáticamente tras 1 minuto para no ensuciar el grupo o topic; las publicaciones reales de feeds se conservan.
- Catálogo canónico de categorías de noticias y aliases reutilizado por agenda, agenda pública, LFG, préstamos, compras conjuntas y altas web (`nuevos_miembros`).
- Publicación de novedades por categoría concreta (agenda interna => `events`, agenda pública filtrada => `public-events`, Avisos => `avisos`, compras conjuntas => `group-purchases`, LFG, préstamos por tipo de ítem, altas web => `nuevos_miembros`) en el destino suscrito; los grupos habilitados reciben los feeds marcados por defecto, como `events` y `group-purchases`, si no tienen ese feed suscrito explícitamente.
- `/admin/news` muestra los feeds disponibles y cuántos destinos activos hay suscritos a cada categoría.

Pendiente:

- Ninguna bloquejadora.

## LFG / buscar grupo

Estado: `operativo`.

Implementado:

- Botón privado `LFG (buscar grupo)` y comando `/lfg` para socios aprobados.
- Listados separados de jugadores que buscan grupo y grupos que buscan jugadores.
- Anuncios de jugador con descripción y anuncios de grupo con título, descripción y plazas opcionales.
- Cada propietario puede consultar, editar, marcar como resuelto o cancelar sus anuncios activos.
- Persistencia en `lfg_player_ads` y `lfg_group_ads`.
- Publicación best-effort en los destinos `/news` suscritos específicamente a `lfg:players` o `lfg:groups`, respetando los topics configurados.

Riesgos o pendientes:

- Los listados activos no tienen paginación y pueden crecer demasiado si aumenta el uso.

## Feedback web y Telegram

Estado: `operativo`.

Implementado:

- Formulario público `/feedback` con límite de 4.000 caracteres.
- Detección local en privado de frustración o insultos en catalán, español e inglés para socios aprobados y no bloqueados.
- La detección sólo ofrece iniciar el flujo: el usuario debe aceptar expresamente y escribir el feedback que desea guardar.
- El fallback LLM puede detectar feedback dirigido al bot; desde grupos/topics deriva el proceso al privado y no guarda el mensaje original.
- Web y Telegram escriben en `data/feedback.jsonl`, visible para admins en `/admin/feedback`.

Riesgos o pendientes:

- La persistencia es JSONL local, sin estados de seguimiento, asignación ni respuesta al remitente desde el panel.

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
- Descripciones enriquecidas con texto y adjuntos opcionales, botón directo de edición para admins/creador y enlaces de descripción en mensajes privados y de grupo; al editar se conserva un único mensaje de detalle e intenta borrar el anterior.
- Deadlines de unión y confirmación.
- Campos personalizados de participante: entero, opción simple o texto; pueden afectar cantidad.
- Unirse como interesado o confirmado, editar valores, salir, gestionar participantes y cambiar estados.
- Publicación automática de nuevas compras en destinos `/news group-purchases`: por defecto llega al grupo completo habilitado, y si existe una suscripción explícita por topic se publica con su `message_thread_id`.
- Cada compra mantiene un único mensaje vivo por destino `chat_id` + `message_thread_id` y borra el mensaje anterior al publicar una actualización.
- Actualizaciones automáticas en grupos/topics cuando alguien se apunta, confirma, edita la compra o se echa atrás; incluyen botones inline para detalle, descripción y participación privada, y en coste compartido muestran coste total, coste actual por persona y usuarios confirmados.
- Mensajes asociados a una compra para trazabilidad interna.
- Recordatorios persistentes antes del deadline de confirmación.

Riesgos o pendientes:

- No hay integración de pagos; estados como pagado/entregado existen en modelo/flujo de participantes, pero no hay cobro real.

## Storage y archivos

Estado: `operativo`.

Implementado:

- `/storage` para usuarios aprobados en privado.
- Categorías con `storageChatId` y `storageThreadId` como ubicación canónica.
- Configuración admin de supergrupo de Storage por defecto desde Telegram, persistida en `app_metadata`.
- Alta de categorías usando automáticamente el supergrupo por defecto vigente: el bot valida chat/permisos, crea el topic y guarda los ids sin pedir confirmación al crear cada categoría.
- Listado incremental de categorías principales/subcategorias con resumen agregado de subcategorias y archivos, enlaces normales `t.me?...start=` en el texto, breadcrumbs clicables, acciones contextuales, cambio guiado de categoría padre, movimiento de entradas por selector nivel a nivel y listado de entradas por categoría.
- Tags visibles como enlaces `#tag (X archivos)` hacia búsqueda por tag, listado paginado de tags, entrada flexible sin `#` en prompts explicitos y gestión desde el detalle de archivo para propietario o admin.
- Criterio de organización visible en los flujos de subida: categorías para ubicación/tipo general del contenido y tags para rasgos cruzados como criaturas, facciones, formatos, campañas o packs mixtos.
- Busqueda de Storage con entrada guiada para buscar por palabra/tag o explorar categorías nivel a nivel, normalizando `#tag` y buscando también por nombre de categoría.
- Las categorías internas `catalog_media` y `role_game_handouts` quedan fuera de la navegación normal, búsqueda, web/TUI Storage y enlaces `storage_entry_<id>`.
- Subida por DM: el usuario elige categoría con selector nivel a nivel, envía adjuntos con recibo editable del total del lote, finaliza, revisa tags con opción de omitir, revisa una vista previa acotada para no superar el límite de Telegram con botones visibles para editar descripción, añadir tags, añadir imágenes o completar, acumula imágenes adicionales con recibo editable, recibe aviso antes de completar sin tags y el bot muestra progreso editable con estado por adjunto mientras copia al topic canónico, indexa y notifica suscripciones; al terminar edita el recibo con enlaces directos a la entrada guardada y a su categoría.
- Subida por reenvio de mensajes de Telegram en privado: en modo neutral el bot pregunta que hacer, permite "Añadir a almacenamiento", acumula mensajes reenviados con un recibo editable del total del lote, pide categoría, precarga descripción/tags/adjuntos/texto desde el mensaje reenviado, filtra enlaces `t.me` de spam antes de derivar descripción o guardar captions y confirma tags antes de mostrar la vista previa.
- Subida directa en topic: si el mensaje cae en un topic asociado a categoría y el usuario tiene permiso, se indexa directamente.
- Soporte de `document`, `photo`, `video` y `audio`.
- Albums por `media_group_id` agrupados en una sola entrada mediante ventana corta en memoria.
- Admin: crear, mover, archivar y reactivar categorías; borrar logicamente entradas; ver, conceder y revocar acceso por categoría.
- Consola Textual `Storage gestor`: editar categorías/archivos existentes, mover categorías dentro de otras o a raíz, mover archivos a otra categoría, archivar/reactivar categorías y eliminar/restaurar archivos sin crear contenido nuevo.
- Panel web `/admin/storage`: navega por categorías/subcategorias como el flujo Telegram, muestra entradas con nombre como dato principal, metadatos y miniatura cuando hay imagen, abre un visor modal protegido para recorrer todas las imágenes de una entrada, gestiona entradas y categorías existentes con búsqueda, cambio de nombre, categoría, tags y estado, movimiento lógico de entradas/categorías y borrado lógico/archivado con confirmación; no permite crear contenido nuevo, que sigue entrando por Telegram.
- Permisos aplicados por recurso para `storage.entry.read` y `storage.entry.upload`.
- Auditoria de altas de categoría, cambios de estado, borrado lógico y permisos.

Mejoras opcionales:

- Si no hay supergrupo por defecto configurado, o deja de ser valido, la seleccion guiada/manual de `storageChatId` y `storageThreadId` se mantiene como fallback.
- La consola puede cambiar el estado de entradas, incluyendo `missing_source`, pero no hay todavia un flujo Telegram dedicado para revisarlas.

Limitaciones aceptadas de la v1:

- No hay OCR, antivirus ni indexado de contenido interno del binario.
- El borrado es lógico en PostgreSQL; no borra físicamente mensajes de Telegram.
- Mover archivos desde la consola es un movimiento lógico de categoría en PostgreSQL; no copia mensajes entre topics de Telegram.
- Si el proceso se reinicia durante la ventana de agrupacion de álbum, ese álbum puede requerir reenvio manual.

Documentación relacionada:

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
- Integración opcional con Bot API local solicitada explícitamente por impresión y por la descarga de referencias de generación de imágenes: el resto del bot sigue usando la ruta cloud por defecto y, si el intento local falla, se registra el error y se usa el fallback cloud.
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
- La v1 de imágenes imprime una imagen como una página A4 ajustada y centrada, con selección vertical u horizontal; no hay todavía configuración de márgenes, tamaño real, recorte, álbumes ni varias imágenes por página.
- Los documentos de Telegram superiores a 20 MB requieren activar y operar el servidor Bot API local en el PC del club; si no está activo, el bot los seguirá rechazando con explicación. Si falta el binario `telegram-bot-api`, el despliegue lo compila desde la fuente oficial de TDLib cuando la feature local está activada.
- No hay cancelación de trabajos ya enviados a CUPS desde el bot.
- La prueba real de papel/tóner queda para validación presencial en el club.

## Generación de imágenes

Estado: `parcial`.

Implementado:

- Botón privado `Generación de imágenes` y comando `/imagegen`, visibles para admins y socios aprobados con `image_generation.use`; la lista de autorizados es independiente de impresión.
- `Describir` acepta una descripción directa, hasta cuatro referencias de imagen y genera al pulsar `Generar imagen`.
- `Guiado` pide una idea general, prepara un prompt personalizado con Codex y permite pedir cambios sucesivos, añadir referencias, generar o cancelar.
- La ejecución usa `GAMECLUB_CODEX_BIN` y `$imagegen` dentro de un directorio temporal por petición; indica a Codex la ruta exacta del PNG y, en caso de éxito, lo devuelve como foto de Telegram y limpia el workspace al completar o cancelar.
- `Admin` -> `Imágenes IA` permite conceder, revocar y listar `image_generation.use`. Los admins siempre acceden sin asignación explícita.
- La optimización del prompt y la generación muestran progreso editable. Esta capacidad queda fuera de `/ask` y de sus intents generales.

Riesgos o pendientes:

- La disponibilidad y cuota dependen del plan y la configuración de Codex de la cuenta operadora.
- No se conservan historial ni imágenes generadas en Storage en esta primera versión.
- La suite automatizada cubre el flujo con un servicio de generación simulado; falta una prueba automatizada o una evidencia operativa registrada que ejercite el wrapper Codex, la creación real del PNG y la subida real a Telegram.
- Un fallo durante la generación puede dejar el directorio temporal hasta una limpieza operativa posterior.

## Backups, consola operativa y panel web

Estado: `técnico operativo`.

Implementado:

- Scripts `backup-cli.sh`, `backup-full.sh` y `restore-full.sh`.
- TUI `npm run backup:console`.
- Consola admin Textual `npm run admin:console` con gestor especifico de Storage.
- Panel web admin protegido por contraseña de elevación, sesión firmada, token CSRF en acciones POST y límite de intentos de login por la dirección remota que observa Node.
- `/admin` abre en un dashboard de estado y métricas principales con toolbar operativa, métricas compactas y tarjetas de navegación por dominio; la operación queda separada en secciones: socios/usuarios en `/admin/users`, bienvenidas de grupo en `/admin/welcome`, actividades en `/admin/activities`, catálogo en `/admin/catalog`, Storage en `/admin/storage`, servicio/logs en `/admin/service`, configuración general —incluida la creación web de actividades y la URL pública usada por los accesos web emitidos desde Telegram— y cambio de token en `/admin/config`, backups en `/admin/backups`, feedback en `/admin/feedback`, feeds en `/admin/news` y altas web en `/admin/member-signups`.
- `/admin/config` permite activar o desactivar la creación web de actividades y configurar la URL pública usada en los enlaces de Telegram; el ajuste se persiste en `app_metadata` y tiene efecto inmediato.
- Configuración de la web pública desde `/admin/web`, persistida en `app_metadata`, con marca CAWA Girona, temas allowlisted, enlaces destacados, contenido de `/club` y referencias a logo/hero/imágenes auxiliares. La shell pública/admin aplica una capa visual más rica con textura de fondo, cabecera con presencia, tarjetas métricas, formularios y tablas refinadas desde el CSS base compartido.
- La shell pública/admin usa los SVG de marca incluidos (`/brand/cawa_logo.svg` como logo por defecto y `/brand/cawa_casco.svg` como favicon), manteniendo los assets subidos desde `/admin/web` como override.
- Assets públicos de portada servidos desde `/assets/...`, guardados bajo `data/http-assets/` con nombre generado, validación de MIME/extensión y límite de 2 MiB.
- Restaurar o eliminar backups desde el panel web exige pantalla intermedia y confirmación textual (`RESTORE`/`DELETE`) además de CSRF.
- Detener el servicio, cambiar el token de Telegram y hacer borrados hard en recursos avanzados requieren confirmación textual (`STOP`, `CHANGE_TOKEN` o `DELETE`); el token pendiente no se reimprime en HTML.
- Secciones públicas iniciales: `/actividades` lista próximas actividades programadas agrupadas por día, ordenadas por fecha y con mesa, juego enlazado, asistentes cuando existen, organizador, plazas en mesas abiertas y duración legible cuando se ha configurado explícitamente; `/catalogo` lista artículos activos con búsqueda, filtro básico por tipo y paginación.
- La ruta con token `/actividad/nueva/<token>` queda fuera de la navegación pública; sólo se ofrece a socios aprobados desde el flujo completo de Agenda cuando el interruptor admin está activo.
- Comando Telegram admin `/restart` para limpiar estado temporal y reiniciar el servicio bajo systemd.
- Deteccion/instalacion asistida de dependencias Debian como `pg_dump` y `psql`.
- Documentación en `docs/backup-restore-recovery.md`.

Riesgos o pendientes:

- La restauración sigue siendo una operación sensible que requiere disciplina operativa; no hay simulación obligatoria antes de restaurar.
- El zip operativo incluye configuración y PostgreSQL, pero no `data/feedback.jsonl` ni `data/http-assets/`; ambos deben copiarse por separado para una recuperación completa del estado persistente en disco.
- Detrás de Nginx, el rate limit de login puede observar la dirección del proxy y agrupar varios clientes; no debe describirse como límite fiable por IP pública sin una estrategia explícita de proxy de confianza.

## Analytics UX

Estado: `técnico parcial`.

Implementado:

- Registro de eventos de menú en `audit_log`.
- CLI `npm run telegram:ux`.
- TUI `npm run telegram:ux:tui`.

Pendiente:

- Vistas de menús sin interacción, breakdown por idioma, filtros avanzados, export JSON/CSV y medición de abandono en flujos largos según `analytics_improvements.md`.

## Pendientes transversales más relevantes

| Pendiente | Área | Prioridad sugerida | Motivo |
| --- | --- | --- | --- |
| Revisión de entradas `missing_source` | Storage | Media | El bot ya marca fuentes perdidas al fallar `copyMessage`; falta una vista admin específica para revisarlas o restaurarlas. |
| UI de permisos general | Admin/permisos | Media | El motor existe, pero falta administración transversal desde el bot. |
| `/news` con botones | Grupos de noticias | Baja | La secció està activa i operativa; revisar si cal refinament de copy o labels en futures iteracions. |
| Perfil de usuario / mi espacio | Usuario | Media | Evitaría que el usuario tenga que entrar por agenda, préstamos y compras por separado. |

## Tests relevantes por área

| Área | Tests principales |
| --- | --- |
| Runtime/menús | `src/telegram/runtime-boundary.test.ts`, `src/telegram/runtime-boundary-support.test.ts`, `src/telegram/runtime-boundary-middleware.test.ts`, `src/telegram/telegram-api-retry.test.ts`, `src/telegram/telegram-api-health.test.ts`, `src/telegram/action-menu.test.ts`, `src/telegram/command-registry.test.ts` |
| Idioma, menús y ayuda | `src/telegram/action-menu.test.ts`, `src/telegram/command-registry.test.ts`, `src/telegram/i18n-command-labels.test.ts`, `src/telegram/submenu-keyboards.test.ts` |
| Bienvenidas/nickname | `src/membership/welcome-template-store.test.ts`, `src/membership/access-flow.test.ts`, `src/telegram/runtime-boundary.test.ts`, `src/telegram/action-menu.test.ts` |
| Acceso | `src/membership/*.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Autorización y auditoría | `src/authorization/service.test.ts`, `src/audit/audit-log.test.ts` |
| LLM / Admin IA | `src/telegram/llm-command-flow.test.ts`, `src/telegram/llm-command-router.test.ts`, `src/telegram/llm-command-service.test.ts`, `src/telegram/llm-command-schema.test.ts`, `src/telegram/llm-command-prompt.test.ts`, `src/telegram/llm-command-read-actions.test.ts`, `src/telegram/llm-command-metrics.test.ts`, `src/telegram/llm-model-admin-flow.test.ts`, `src/telegram/llm-model-settings.test.ts`, `src/telegram/admin-ai-flow.test.ts` |
| Agenda | `src/telegram/schedule-flow.test.ts`, `src/telegram/calendar-flow.test.ts`, `src/telegram/schedule-parsing.test.ts`, `src/telegram/schedule-presentation.test.ts`, `src/telegram/promotion-destination-flow.test.ts`, `src/schedule/schedule-catalog.test.ts`, `src/schedule/schedule-catalog-store.test.ts`, `src/schedule/schedule-table-selection.test.ts`, `src/schedule/*reminder*.test.ts` |
| Google Calendar | `src/google-calendar/google-calendar-settings.test.ts`, `src/google-calendar/google-calendar-sync.test.ts`, `src/telegram/google-calendar-public-link-flow.test.ts` |
| Mesas | `src/telegram/table-admin-flow.test.ts`, `src/telegram/table-read-flow.test.ts` |
| Equipamiento | `src/equipment/equipment-catalog.test.ts`, `src/telegram/equipment-admin-flow.test.ts`, `src/telegram/schedule-flow.test.ts`, `src/schedule/schedule-catalog.test.ts`, `src/schedule/schedule-catalog-store.test.ts` |
| Eventos del local | `src/telegram/venue-event-admin-flow.test.ts`, `src/venue-events/venue-event-catalog.test.ts`, `src/venue-events/venue-event-catalog-store.test.ts`, `src/venue-events/venue-event-impact-signals.test.ts`, `src/telegram/today-at-club-summary.test.ts` |
| Catálogo | `src/telegram/catalog-admin-flow.test.ts`, `src/telegram/catalog-admin-position.test.ts`, `src/telegram/catalog-admin-browse-ui.test.ts`, `src/telegram/catalog-read-flow.test.ts`, `src/catalog/*.test.ts` |
| Préstamos | `src/telegram/catalog-loan-flow.test.ts`, `src/catalog/catalog-loan-reminders.test.ts`, `src/catalog/catalog-loan-store.test.ts` |
| LFG | `src/telegram/lfg-flow.test.ts`, `src/lfg/lfg-catalog.test.ts`, `src/lfg/lfg-catalog-store.test.ts` |
| Compras conjuntas | `src/telegram/group-purchase-flow.test.ts`, `src/group-purchases/*.test.ts` |
| Rol / partidas de rol | `src/role-games/role-game-catalog.test.ts`, `src/role-games/role-game-catalog-store.test.ts`, `src/role-games/role-game-notion-store.test.ts`, `src/notion/notion-client.test.ts`, `src/notion/notion-renderer.test.ts`, `src/notion/notion-webhook.test.ts`, `src/role-games/role-game-character-catalog.test.ts`, `src/role-games/role-game-character-store.test.ts`, `src/role-games/role-game-character-store.integration.test.ts`, `src/role-games/role-game-scheduler.test.ts`, `src/role-games/role-game-auto-scheduling-store.test.ts`, `src/role-games/role-game-recurrence-worker.test.ts`, `src/telegram/role-game-participants.test.ts`, `src/telegram/role-game-flow.test.ts`, `src/telegram/role-game-notion-flow.test.ts`, `src/telegram/role-game-character-flow.test.ts`, `src/telegram/role-game-auto-scheduling-admin-flow.test.ts`, `src/bootstrap/create-app.test.ts`, `src/telegram/action-menu.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Avisos | `src/telegram/notice-flow.test.ts`, `src/notices/*.test.ts`, `src/news/news-group-store.test.ts` |
| Storage | `src/telegram/storage-flow.test.ts`, `src/storage/*.test.ts` |
| Noticias | `src/telegram/news-group-flow.test.ts`, `src/news/news-group-store.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Feedback Telegram | `src/telegram/feedback-flow.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Impresión | `src/telegram/print-flow.test.ts`, `src/telegram/printer-admin-flow.test.ts`, `src/printing/page-selection.test.ts`, `src/printing/print-service.test.ts`, `src/printing/print-settings.test.ts`, `src/printing/print-permissions.test.ts`, `src/printing/print-job-history.test.ts`, `src/telegram/telegram-local-file-download.test.ts` |
| Generación de imágenes | `src/telegram/image-generation-flow.test.ts` |
| Panel HTTP y web pública | `src/http/admin-http-server.test.ts`, `src/http/http-theme.test.ts`, `src/http/web-settings-store.test.ts` |
| Operación | `src/tui/*.test.ts`, `src/operations/*.test.ts`, `src/tray/*.test.ts` |
