# Estado real de features

Ultima revision: 2026-05-04.

Este documento refleja lo que existe en el codigo actual, no solo lo que aparece en planes o specs. Los estados usados son:

- `operativo`: implementado en el bot, persistido si aplica y cubierto por tests relevantes.
- `parcial`: hay implementacion usable, pero falta una parte importante de UX, operacion o alcance.
- `pendiente`: esta documentado o preparado en modelo/backlog, pero no hay flujo completo en el bot.
- `tecnico`: capacidad de infraestructura u operacion, no una feature visible para socios.

## Resumen ejecutivo

| Area | Estado | Lectura actual |
| --- | --- | --- |
| Runtime, configuracion y despliegue | tecnico operativo | Base solida con TypeScript, PostgreSQL, Drizzle, bootstrap, long polling, systemd/tray y backups. |
| Acceso, usuarios y admins | operativo | Solicitud/aprobacion/rechazo/revocacion, elevacion admin y avisos privados a admins. |
| Idioma, menus y ayuda | operativo | Idiomas `ca`, `es`, `en`, menu por rol/contexto y ayuda contextual por seccion activa. |
| Mesas | operativo | CRUD admin y consulta de mesas activas. |
| Agenda de actividades | operativo | Crear/listar/editar/cancelar, apuntarse/salir, mesas, plazas, conflictos, recordatorios y publicacion a grupos de noticias. |
| Eventos del local | operativo | CRUD/cancelacion admin e impacto visible en agenda y resumen diario. |
| Catalogo | operativo con integraciones parciales | CRUD, familias/grupos, busqueda, media por URL, importacion asistida desde Wikipedia/Open Library y coleccion BGG. BGG por busqueda individual no es la fuente principal actual. |
| Prestamos | operativo parcial | Prestamo/devolucion/edicion de notas y fecha prevista. Falta worker de recordatorios de prestamos. |
| Grupos de noticias | operativo parcial | Comandos `/news` para activar/desactivar y suscribirse. Falta UX con botones. |
| Compras conjuntas | operativo | Crear/listar/unirse/confirmar/gestionar participantes, mensajes, publicacion y recordatorios de deadline. |
| Storage/archivos | operativo | Indice funcional de adjuntos en Telegram con categorias, permisos, busqueda, DM upload, topic upload, alta guiada de categorias, seleccion simple de usuarios para accesos y marcado de fuentes perdidas. |
| Backups y operacion TUI | tecnico operativo | CLI y TUI para backup/restore, estado del servicio y dependencias Debian. |
| Analytics UX | tecnico parcial | Hay reporte/TUI de menu UX; mejoras avanzadas siguen en backlog. |

## Runtime y operacion

Estado: `tecnico operativo`.

Implementado:

- Arranque principal en `src/main.ts` y `src/main-program.ts`.
- Configuracion runtime validada con `zod` y editor/wizard en `src/config/*` y `src/bootstrap/*`.
- PostgreSQL con Drizzle, schema central y migraciones en `src/infrastructure/database/schema.ts`.
- Long polling con `allowed_updates` limitado a `message` y `callback_query` en `src/telegram/runtime-boundary-support.ts`.
- Scripts de operacion, systemd, tray Debian y backups documentados en `README.md`, `docs/debian-service-operations.md`, `docs/debian-tray-operations.md` y `docs/backup-restore-recovery.md`.

Riesgos o pendientes:

- El bot usa polling, no webhook. Esta bien para el despliegue actual, pero no hay hardening de webhook porque no aplica.
- `featureFlags` existe en configuracion, pero la mayoria de features visibles no estan realmente gateadas por flags.

## Acceso, usuarios y admins

Estado: `operativo`.

Implementado:

- `/access` crea solicitudes y soporta reintentos segun estado del usuario.
- `/review_access`, `/approve`, `/reject` y callbacks inline resuelven solicitudes.
- `/manage_users` permite expulsar/revocar usuarios aprobados no admin con motivo.
- `/elevate_admin` eleva a admin usando hash de password runtime.
- `/subscribe_requests` y `/unsubscribe_requests` permiten avisos privados de nuevas solicitudes.
- Las revocaciones notifican al usuario afectado y a admins suscritos.
- Persistencia y auditoria en `users`, `user_status_audit_log`, `user_permission_assignments` y `user_permission_audit_log`.

Riesgos o pendientes:

- No hay una UI general para conceder/revocar cualquier permiso global o por recurso. Solo hay flujos especificos, como storage category access.

## Idioma, menus y ayuda

Estado: `operativo`.

Implementado:

- `/language` y flujo de idioma en privado/grupo.
- Menu principal dinamico por rol, estado, chat y sesion en `src/telegram/action-menu.ts`.
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

Estado: `operativo con integraciones parciales`.

Implementado:

- `/catalog` para crear, listar, buscar, inspeccionar, editar y desactivar items.
- Tipos: juegos de mesa, expansiones, libros, libros RPG y accesorios.
- Familias y grupos para agrupar lineas, colecciones o expansiones.
- Campos principales: titulo, original, descripcion, idioma, editorial, año, jugadores, edad, duracion, referencias externas y metadata.
- Media por URL con tipo `image`, `link` o `document`.
- `/catalog_search` como consulta para usuarios aprobados.
- Creacion de actividad desde item del catalogo y aviso si el item esta prestado.

Integraciones reales:

- Juegos de mesa: importacion asistida desde Wikipedia en el flujo de alta.
- Libros y RPG: lookup HTTP hacia servicios externos desde `catalog-lookup-service`.
- BoardGameGeek: hay importacion de coleccion BGG en `catalog-admin-support.ts` y servicio en `wikipedia-boardgame-import-service.ts`; no es la fuente principal del alta individual de juegos, que actualmente intenta Wikipedia primero.

Riesgos o pendientes:

- El nombre historico `wikipedia-boardgame-import-service.ts` mezcla Wikipedia, Open Library y BGG collection, lo que puede confundir mantenimiento.
- No hay descarga/subida binaria de imagenes del catalogo; media guarda URLs.

## Prestamos

Estado: `operativo parcial`.

Implementado:

- Crear prestamo desde botones del detalle/listado de catalogo.
- Devolver prestamo desde botones.
- Consultar prestamos activos propios.
- Editar notas y fecha prevista de devolucion.
- Publicar eventos de prestamo/devolucion a grupos de noticias por categoria.
- Restriccion persistente de un prestamo activo por item.

Pendiente:

- Recordatorios de prestamos cuando se acerca o vence la fecha prevista (`FUNCTIONAL_RECOMMENDATIONS.md`, F-010).
- Flujo admin dedicado para ver todos los prestamos activos como dashboard.

## Grupos de noticias

Estado: `operativo parcial`.

Implementado:

- `/news status`, `/news enable`, `/news disable`, `/news subscribe <categoria>` y `/news unsubscribe <categoria>` en grupos.
- Persistencia de grupos habilitados y suscripciones por categoria.
- Usado por agenda, prestamos y compras conjuntas para publicar novedades.

Pendiente:

- UX con botones para administrar suscripciones sin recordar comandos (`FUNCTIONAL_RECOMMENDATIONS.md`, F-011).
- Catalogo central visible de categorias de noticias disponibles.

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
- Alta guiada de categorias: el admin comparte el supergrupo, el bot valida chat/permisos, crea el topic y guarda los ids automaticamente.
- Listado de categorias, listado de entradas por categoria, busqueda y apertura de entrada por id.
- Subida por DM: el usuario elige categoria, envia adjuntos, finaliza, añade descripcion/tags y el bot copia al topic canonico antes de indexar.
- Subida directa en topic: si el mensaje cae en un topic asociado a categoria y el usuario tiene permiso, se indexa directamente.
- Soporte de `document`, `photo`, `video` y `audio`.
- Albums por `media_group_id` agrupados en una sola entrada mediante ventana corta en memoria.
- Admin: crear, archivar y reactivar categorias; borrar logicamente entradas; ver, conceder y revocar acceso por categoria.
- Permisos aplicados por recurso para `storage.entry.read` y `storage.entry.upload`.
- Auditoria de altas de categoria, cambios de estado, borrado logico y permisos.

Mejoras opcionales:

- La entrada manual de `storageChatId` y `storageThreadId` se mantiene como fallback, no como camino principal.
- No hay flujo dedicado para revisar/restaurar entradas marcadas como `missing_source`.

Limitaciones aceptadas de la v1:

- No hay OCR, antivirus ni indexado de contenido interno del binario.
- El borrado es logico en PostgreSQL; no borra fisicamente mensajes de Telegram.
- Si el proceso se reinicia durante la ventana de agrupacion de album, ese album puede requerir reenvio manual.

Documentacion relacionada:

- `STORAGE.md` describe la v1 implementada.
- `STORAGE_GROUP_IMPROVEMENT.md` describe el diseño usado para la alta guiada de categorias.
- `docs/superpowers/specs/2026-04-21-telegram-storage-design.md` contiene el diseño original.

## Backups y consola operativa

Estado: `tecnico operativo`.

Implementado:

- Scripts `backup-cli.sh`, `backup-full.sh` y `restore-full.sh`.
- TUI `npm run backup:console`.
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
| Recordatorios de prestamos | Prestamos | Media | El modelo tiene fecha prevista, pero no hay worker equivalente a agenda/compras. |
| UI de permisos general | Admin/permisos | Media | El motor existe, pero falta administracion transversal desde el bot. |
| `/news` con botones | Grupos de noticias | Media | La feature funciona por comandos, pero la UX no es consistente con el resto del bot. |
| Dashboard admin | Admin | Media | Hay datos suficientes, falta una vista agregada. |
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
