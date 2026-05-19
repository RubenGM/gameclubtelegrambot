# Estado real de features

Ultima revision: 2026-05-19.

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
| Runtime, configuración y despliegue           | 🟢 Operativo         | Base sólida con TypeScript, PostgreSQL, Drizzle, bootstrap, long polling, canarios/reintentos Telegram, systemd/tray y backups.           |
| Acceso, usuarios y admins                    | 🟢 Operativo         | Solicitud/aprobación/rechazo/revocación, gestión detallada, avisos privados, `/status`, `/restart` y alta web inicial en `/alta`.          |
| Idioma, menús y ayuda                        | 🟢 Operativo         | `ca`, `es`, `en` + menú por rol/contexto y ayuda contextual por sección activa.                                                          |
| Mesas                                        | 🟢 Operativo         | Administración de mesas y consulta de tablas activas para socios.                                                                        |
| Agenda de actividades                        | 🟢 Operativo         | Crear/listar/editar/cancelar, apuntarse/salir, plazas, conflictos, recordatorios y publicación en canales de noticias.                   |
| Eventos del local                            | 🟢 Operativo         | Gestión de eventos por admins con impacto directo en agenda y resumen diario.                                                           |
| Catálogo                                     | 🟢 Operativo         | CRUD, familias, búsqueda, media por URL/adjunto con Storage interno, BGG/Open Library/Wikipedia y detección de título por portada.       |
| Préstamos                                    | 🟢 Operativo         | Flujo principal funcional con recordatorios privados, dashboard admin de préstamos activos y avisos de fecha prevista/vencimiento.          |
| Grupos de noticias                           | 🟢 Operativo         | `/news` y `/admin/news` gestionan/visibilizan suscripciones por categoría, incluyendo el feed `nuevos_miembros` para altas web.          |
| Compras conjuntas                            | 🟢 Operativo         | Crear/listar/unirse/confirmar, gestión de participantes y recordatorios de deadline.                                                    |
| Storage / Archivos                           | 🟢 Operativo         | Índice de adjuntos con categorías, permisos, búsquedas y procesos de carga (DM y topic).                                              |
| Backups, operación y panel web               | 🟢 Operativo         | CLI/TUI de backup/restore, gestión Debian, dashboard web, secciones admin separadas, temas CAWA, assets y secciones públicas.             |
| Analytics / UX                               | 🟡 Técnico parcial    | Existe reporte/TUI operativo y wrapper OpenCode para leer imágenes, con mejoras de analítica avanzada pendientes.                         |
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
- Capa intermedia de reintentos para envios y operaciones Telegram en `src/telegram/telegram-api-retry.ts`, usada desde el boundary runtime.
- Canario de salud de Telegram API: detecta fallos transitorios, mantiene estado degradado temporal y añade aviso a mensajes de texto mientras dura la incidencia.
- Scripts de operacion, systemd, tray Debian y backups documentados en `README.md`, `docs/debian-service-operations.md`, `docs/debian-tray-operations.md` y `docs/backup-restore-recovery.md`.
- Herramienta `npm run opencode:image` y wrapper `scripts/opencode-cawa.sh` para enviar prompts/imagenes a OpenCode con el usuario operador; usa `openai/gpt-5.4-mini` por defecto y esta pensada como paso previo a búsquedas BGG o traducciones asistidas, no como fuente de metadatos.
- Panel HTTP integrado en el servicio del bot (`src/http/admin-http-server.ts`): portada pública en `/`, feedback público en `/feedback`, alta de socio en `/alta`, información del club en `/club`, actividades futuras en `/actividades`, catálogo público en `/catalogo`, admin protegido en `/admin` y edición de marca/contenido/tema, enlaces destacados y assets de portada en `/admin/web`.
- El despliegue público usa Nginx como reverse proxy hacia `127.0.0.1:8787` con HTTPS de Let's Encrypt para `cawa.hopto.org`.

Riesgos o pendientes:

- El bot usa polling, no webhook. Esta bien para el despliegue actual, pero no hay hardening de webhook porque no aplica.
- `featureFlags` existe en configuracion, pero la mayoria de features visibles no estan realmente gateadas por flags.

## Acceso, usuarios y admins

Estado: `operativo`.

Implementado:

- `/access` crea solicitudes y soporta reintentos segun estado del usuario.
- `/review_access`, `/approve`, `/reject` y callbacks inline resuelven solicitudes.
- `/manage_users` abre una pantalla de gestion: lista usuarios registrados con nombre enlazado al detalle, username clicable, estado y rol.
- El detalle de usuario resume identidad, estado, rol, prestamos activos, actividades futuras y actividades recientes.
- Desde el detalle, los admins pueden expulsar socios no admin con motivo, ascender socios a admin y eliminar rol admin sin revocar acceso de socio.
- La gestion de rol admin escribe auditoria en `user_permission_audit_log` y `audit_log`.
- `/elevate_admin` eleva a admin usando hash de password runtime.
- `/subscribe_requests` y `/unsubscribe_requests` permiten avisos privados de nuevas solicitudes.
- `/alta` registra solicitudes de alta desde la web en `member_signup_requests`, avisa por privado a admins aprobados y publica en grupos suscritos al feed `nuevos_miembros`.
- `/admin/member-signups` permite revisar desde el panel web las solicitudes de alta recibidas, su estado, el resumen de avisos enviados y marcar cada solicitud como contactada, aprobada, rechazada o pendiente.
- Las revocaciones notifican al usuario afectado y a admins suscritos.
- Persistencia y auditoria en `users`, `user_status_audit_log`, `user_permission_assignments` y `user_permission_audit_log`.

Riesgos o pendientes:

- No hay una UI general para conceder/revocar cualquier permiso global o por recurso. Hay flujos especificos para rol admin, revocacion de acceso y storage category access.

## Idioma, menus y ayuda

Estado: `operativo`.

Implementado:

- `/language` y flujo de idioma en privado/grupo.
- Menu principal dinamico por rol, estado, chat y sesion en `src/telegram/action-menu.ts`.
- `Inicio` y `/start` normal limpian cualquier sesion activa antes de reconstruir la portada, evitando dejar al usuario atrapado con un teclado de `/cancel`.
- Ayuda contextual en `src/telegram/command-registry.ts` y seccion activa gestionada desde `runtime-boundary-registration.ts`.
- Soporte visible para `ca`, `es` y `en`.

Riesgos o pendientes:

- Muchos flujos dependen de comparar texto localizado de botones. Cambios de copy pueden romper acciones si no se actualizan tests.

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
- Soporte de fecha, hora, duracion, mesa opcional, modo abierto/cerrado, plazas iniciales ocupadas y capacidad.
- Preferencia de recordatorio al apuntarse y worker persistente de recordatorios.
- Avisos de conflicto y capacidad al crear/editar.
- Integracion con eventos del local para mostrar impacto.
- Publicacion de snapshot a grupos de noticias suscritos.

Riesgos o pendientes:

- No bloquea solapes; el comportamiento real es avisar y permitir continuar.
- Los recordatorios dependen del worker interno y de `notifications.defaults.eventRemindersEnabled`.

## Eventos del local

Estado: `operativo`.

Implementado:

- `/venue_events` para admins con crear, listar, editar y cancelar.
- Soporta eventos de dia completo o con horario, ocupacion parcial/total e impacto bajo/medio/alto.
- Impacto usado por agenda y resumen `Hoy en el club`.

Riesgos o pendientes:

- No hay gestion desde grupos; es flujo privado admin.

## Catalogo

Estado: `operativo`.

Implementado:

- `/catalog` para crear, listar, buscar, inspeccionar, editar y desactivar items.
- `/catalog_bulk` y el botón de menú "Añadir múltiples" para importar varios items en lote en background (separados por coma) con resumen final.
- Tipos: juegos de mesa, expansiones, libros, libros RPG y accesorios.
- Familias y grupos para agrupar lineas, colecciones o expansiones.
- Campos principales: titulo, original, descripcion, idioma, editorial, año, jugadores, edad, duracion, referencias externas y metadata.
- Propietario opcional por item: un usuario puede asignarse como propietario desde el detalle; los admins pueden asignar otro usuario con selector paginado y quitar el propietario. El detalle muestra el nombre enlazado.
- Media por URL con tipo `image`, `link` o `document`.
- Los admins pueden añadir imagen a un item existente desde el detalle usando URL o adjunto Telegram.
- Los admins pueden autocorregir datos de juegos/expansiones y libros desde el detalle: el bot reconsulta BGG/Open Library con el titulo o ID disponible, si BGG devuelve varias coincidencias muestra opciones para elegir manualmente, intenta traducir al castellano las descripciones BGG cuando el bot esta en español usando DeepL si esta configurado y OpenCode como fallback, actualiza campos, limpia referencias externas/metadata visibles, edita un mensaje de progreso con duracion por paso (API, traduccion, guardado, descarga/subida de portada y detalle) y reporta si la portada se ha importado, ya existia o no estaba disponible. Tambien pueden traducir solo la descripcion actual del item sin tocar el resto de datos.
- Las imagenes reales del catalogo se guardan como entradas de Storage en una categoria interna `catalog_media`, oculta de la navegacion normal de `/storage`.
- La media principal de un item es la primera imagen por `sortOrder`, usando `0` como portada.
- Al abrir el detalle de un item, el bot intenta mostrar primero la portada principal y despues una ficha resumida con breadcrumbs, titulo, propietario si existe, disponibilidad, prestatario si existe, jugadores, duracion y enlace "Ver detalles" a la ficha completa.
- Las acciones del detalle de item se muestran en teclado de respuesta persistente para mantener libres los enlaces HTML dentro del mensaje.
- En el alta de juegos/libros, el paso de nombre acepta una foto o documento de imagen de la portada; OpenCode sugiere el titulo y, si se crea el item, el bot pregunta si se guarda esa portada como imagen principal.
- `/catalog_search` como consulta para usuarios aprobados.
- Vista de lectura con indice por rangos de tres iniciales: cada bloque muestra total de articulos y desglose por juegos de mesa, libros y accesorios, con enlaces normales `t.me?...start=` en el texto; los grupos internos no aparecen en la navegacion principal.
- Creacion de actividad desde item del catalogo y aviso si el item esta prestado.
- Los avisos de prestamo en grupos de noticias intentan publicar una sola imagen: la portada principal del item; si falla, mantienen el texto actual.

Integraciones reales:

- Juegos de mesa: BGG es la fuente principal cuando `bgg.apiKey` esta configurada, con Wikipedia como fallback operativo.
- Libros y RPG: lookup HTTP hacia Open Library desde `catalog-lookup-service`, incluyendo portada cuando Open Library expone `cover_i`, `cover_edition_key` o ISBN utilizable.
- BoardGameGeek: importacion individual, autocorreccion desde detalle y coleccion operativas; cuando BGG devuelve portada, el bot descarga la `imageUrl`/`coverUrl` y la sube a Storage como portada.
- Open Library: cuando devuelve portada, el alta intenta guardarla como portada.
- OpenCode: solo se usa para leer el titulo visible desde la portada; los metadatos completos siguen viniendo de APIs catalogadas como BGG/Open Library/Wikipedia.

Riesgos o pendientes:

- El nombre historico `wikipedia-boardgame-import-service.ts` mezcla Wikipedia, Open Library y BGG collection, lo que puede confundir mantenimiento.
- La importacion automatica de imagenes externas es best-effort: si Telegram no acepta la URL o no hay Storage por defecto configurado, el item se crea igual.

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

- `/news status`, `/news enable`, `/news disable`, `/news subscribe <categoria>` y `/news unsubscribe <categoria>` en grupos.
- Persistencia de grupos habilitados y suscripciones por categoria.
- Teclat inline de `/news` con `activar/desactivar`, `subscriure`, `desubscriure`, `refresh` y estado actual.
- Catálogo canónico de categories de noticias y aliases reutilizado por agenda, LFG, préstecs y altas web (`nuevos_miembros`).
- Publicación de novedades por categoría concreta (agenda => `events`, LFG, préstecs por tipus d’ítem y altas web => `nuevos_miembros`).
- `/admin/news` muestra los feeds disponibles y cuántos grupos activos hay suscritos a cada categoría.

Pendiente:

- Ninguna bloquejadora.

## Compras conjuntas

Estado: `operativo`.

Implementado:

- `/group_purchases` con crear y listar.
- Modos de compra por unidad o coste compartido.
- Deadlines de union y confirmacion.
- Campos personalizados de participante: entero, opcion simple o texto; pueden afectar cantidad.
- Unirse como interesado o confirmado, editar valores, salir, gestionar participantes y cambiar estados.
- Mensajes asociados a una compra y publicacion a grupo.
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
- Subida por DM: el usuario elige categoria con selector nivel a nivel, envia adjuntos, finaliza, revisa tags con opcion de omitir, revisa una vista previa con botones visibles para editar descripcion, añadir tags, añadir imagenes o completar, recibe aviso antes de completar sin tags y el bot muestra progreso editable con estado por adjunto mientras copia al topic canonico, indexa, notifica suscripciones y refresca la categoria.
- Subida por reenvio de mensajes de Telegram en privado: en modo neutral el bot pregunta que hacer, permite "Añadir a almacenamiento", pide categoria, precarga descripcion/tags/adjuntos/texto desde el mensaje reenviado y confirma tags antes de mostrar la vista previa.
- Subida directa en topic: si el mensaje cae en un topic asociado a categoria y el usuario tiene permiso, se indexa directamente.
- Soporte de `document`, `photo`, `video` y `audio`.
- Albums por `media_group_id` agrupados en una sola entrada mediante ventana corta en memoria.
- Admin: crear, mover, archivar y reactivar categorias; borrar logicamente entradas; ver, conceder y revocar acceso por categoria.
- Consola Textual `Storage gestor`: editar categorias/archivos existentes, mover categorias dentro de otras o a raiz, mover archivos a otra categoria, archivar/reactivar categorias y eliminar/restaurar archivos sin crear contenido nuevo.
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

## Backups, consola operativa y panel web

Estado: `tecnico operativo`.

Implementado:

- Scripts `backup-cli.sh`, `backup-full.sh` y `restore-full.sh`.
- TUI `npm run backup:console`.
- Consola admin Textual `npm run admin:console` con gestor especifico de Storage.
- Panel web admin protegido por contraseña de elevación, sesión firmada, token CSRF en acciones POST y límite de intentos de login por IP.
- `/admin` abre en un dashboard de estado y métricas principales; la operación queda separada en secciones: socios/usuarios en `/admin/users`, actividades en `/admin/activities`, catálogo en `/admin/catalog`, servicio/logs en `/admin/service`, configuración técnica y cambio de token en `/admin/config`, backups en `/admin/backups`, feedback en `/admin/feedback`, feeds en `/admin/news` y altas web en `/admin/member-signups`.
- Configuración de la web pública desde `/admin/web`, persistida en `app_metadata`, con marca CAWA Girona, temas allowlisted, enlaces destacados, contenido de `/club` y referencias a logo/hero/imagenes auxiliares.
- La shell pública/admin usa los SVG de marca incluidos (`/brand/cawa_logo.svg` como logo por defecto y `/brand/cawa_casco.svg` como favicon), manteniendo los assets subidos desde `/admin/web` como override.
- Assets públicos de portada servidos desde `/assets/...`, guardados bajo `data/http-assets/` con nombre generado, validación de MIME/extensión y límite de 2 MiB.
- Restaurar o eliminar backups desde el panel web exige pantalla intermedia y confirmación textual (`RESTORE`/`DELETE`) además de CSRF.
- Detener el servicio, cambiar el token de Telegram y hacer borrados hard en recursos avanzados requieren confirmación textual (`STOP`, `CHANGE_TOKEN` o `DELETE`); el token pendiente no se reimprime en HTML.
- Secciones públicas iniciales: `/actividades` lista próximas actividades programadas y `/catalogo` lista artículos activos con búsqueda, filtro básico por tipo y paginación.
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
| Acceso | `src/membership/*.test.ts`, `src/telegram/runtime-boundary.test.ts` |
| Agenda | `src/telegram/schedule-flow.test.ts`, `src/schedule/*reminder*.test.ts` |
| Mesas | `src/telegram/table-admin-flow.test.ts`, `src/telegram/table-read-flow.test.ts` |
| Catalogo | `src/telegram/catalog-admin-flow.test.ts`, `src/telegram/catalog-read-flow.test.ts`, `src/catalog/*.test.ts` |
| Prestamos | `src/telegram/catalog-loan-flow.test.ts`, `src/catalog/catalog-loan-store.test.ts` |
| Compras conjuntas | `src/telegram/group-purchase-flow.test.ts`, `src/group-purchases/*.test.ts` |
| Storage | `src/telegram/storage-flow.test.ts`, `src/storage/*.test.ts` |
| Noticias | `src/telegram/news-group-flow.test.ts`, `src/news/news-group-store.test.ts` |
| Operacion | `src/tui/*.test.ts`, `src/operations/*.test.ts`, `src/tray/*.test.ts` |
