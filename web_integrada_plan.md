# Plan de accion: web integrada publica y panel admin

## Objetivo

Convertir el Admin HTTP server integrado del bot en una web publica basica pero
util para el club y en un panel admin por secciones, manteniendo el backend
dentro de `gameclubtelegrambot.service`.

La web publica debe permitir personalizar cabecera, logos, imagenes y tema
desde `/admin`, exponer secciones publicas nuevas y aceptar solicitudes de alta
como socio. El panel admin debe abrir con estadisticas e informacion relevante,
no con operaciones sensibles, y debe separar cada funcionalidad con avisos y
confirmaciones cuando una accion pueda destruir o alterar datos importantes.

## Estado actual verificado

- El servidor web vive en `src/http/admin-http-server.ts`.
- Rutas actuales:
  - `/`: bienvenida publica muy simple.
  - `/feedback`: formulario publico que guarda JSONL.
  - `/admin/login`: login por password de elevacion admin.
  - `/admin`: panel protegido con servicio, config, base de datos, backups,
    dependencias y logs.
  - `/admin/resources...`: CRUD generico sobre tablas internas.
- Seguridad actual:
  - Sesion firmada con cookie HTTP-only.
  - POST admin con CSRF.
  - Rate limit basico de login por IP.
  - El backend escucha en `127.0.0.1:8787`; Nginx publica `/`, `/feedback` y
    `/admin`.
- El HTML y CSS estan inline en `page(...)`, sin sistema de layouts, assets ni
  temas.
- El sistema de feeds de grupos ya existe con `news_groups` y
  `news_group_subscriptions`; las categorias actuales estan en
  `src/news/news-group-catalog.ts`.
- Las notificaciones privadas de solicitudes de acceso ya tienen logica
  reutilizable en `src/membership/request-notification-store.ts`, pero son para
  `/access` y suscriptores privados, no para altas desde la web.
- `docs/feature-status.md` registra el panel web como operativo, pero solo con
  bienvenida publica, feedback y admin protegido.

## Alcance funcional

### Web publica

- Mantener `/` como portada publica.
- Mantener `/feedback` como formulario publico.
- Mantener `/admin` como entrada al panel protegido.
- Anadir navegacion desde la portada a:
  - Panel de administracion.
  - Feedback.
  - Horarios de actividades.
  - Catalogo de juegos y libros.
  - Informacion del club.
  - Alta como socio.
  - Futuras secciones publicas configurables.
- La portada debe poder personalizarse desde `/admin`:
  - Titulo/cabecera principal.
  - Texto introductorio.
  - Logo principal.
  - Imagen de portada o hero.
  - Imagenes auxiliares opcionales.
  - Enlaces destacados.
  - Tema CSS activo.
- Las imagenes deben guardarse de forma controlada:
  - Preferible: directorio publico bajo `data/http-assets/` o similar, servido
    solo como assets estaticos.
  - Validar MIME/extensiones y tamano.
  - No permitir rutas arbitrarias ni sobrescribir ficheros fuera del directorio
    de assets.

### Seccion de horarios

- Nueva ruta publica, por ejemplo `/actividades`.
- Mostrar proximas actividades programadas, agrupadas por fecha.
- Usar datos reales de `schedule_events`.
- Excluir canceladas por defecto.
- Mostrar como minimo:
  - Titulo.
  - Fecha y hora.
  - Duracion.
  - Plazas/capacidad cuando aplique.
  - Descripcion corta si existe.
  - Enlace o llamada a abrir el bot para apuntarse cuando sea posible.
- Definir estado vacio claro si no hay actividades futuras.

### Seccion de catalogo

- Nueva ruta publica, por ejemplo `/catalogo`.
- Mostrar juegos y libros activos de `catalog_items`.
- Permitir filtrado basico por tipo:
  - Juegos de mesa.
  - Libros.
  - Libros de rol.
  - Otros si el catalogo los contiene.
- Permitir busqueda por texto.
- Mostrar item con:
  - Nombre.
  - Tipo.
  - Familia/grupo cuando exista.
  - Datos relevantes como jugadores, edad, duracion, editorial o ano.
  - Portada/imagen si existe una media publica usable.
- Paginacion o limite razonable para evitar paginas enormes.
- No exponer datos internos, IDs tecnicos innecesarios ni acciones admin.

### Seccion de informacion del club

- Nueva ruta publica, por ejemplo `/club`.
- Contenido configurable desde `/admin`:
  - Descripcion del club.
  - Direccion o zona.
  - Horarios generales.
  - Contacto.
  - Normas basicas.
  - Enlaces externos.
- Guardar esta configuracion como contenido estructurado, no hardcodeado en
  TypeScript.

### Formulario de alta como socio

- Nueva ruta publica, por ejemplo `/alta`.
- Campos iniciales:
  - Nombre.
  - Alias/usuario Telegram opcional.
  - Contacto.
  - Motivo o mensaje.
  - Aceptacion de condiciones basicas si se decide publicar texto legal.
- Al enviar:
  - Persistir solicitud en una tabla nueva o en un JSONL especifico solo como
    paso inicial. Preferible tabla nueva si se quiere gestion admin posterior.
  - Enviar mensaje privado por Telegram a todos los usuarios aprobados con rol
    admin.
  - Publicar tambien en grupos de noticias suscritos al feed
    `nuevos_miembros`.
  - Mostrar confirmacion publica sin revelar chats, admins ni tokens.
- El mensaje Telegram debe incluir:
  - Datos del solicitante.
  - Origen: formulario web.
  - Fecha.
  - Enlace al panel admin o accion de revision si se implementa en esta fase.
- El envio debe tolerar fallos parciales:
  - Guardar la solicitud aunque algun mensaje falle.
  - Log estructurado con destinatario y causa.
  - Resumen admin de envios correctos/fallidos.

### Feed `nuevos_miembros`

- Anadir categoria nueva en `src/news/news-group-catalog.ts`:
  - Key canonica: `nuevos_miembros`.
  - Aliases: `nuevos_miembros`, `new-members`, `socios`, `members`.
  - Labels/descripciones en `ca`, `es`, `en`.
  - `defaultSubscribed: false`.
- Reutilizar `news_group_subscriptions` y `listSubscribedGroupsByCategory`.
- Actualizar tests de `/news` para que la categoria aparezca y se pueda
  suscribir/desuscribir.

## Panel admin

### Nueva estructura

- `/admin` debe ser un dashboard inicial, no una pagina de mantenimiento crudo.
- Primer bloque:
  - Estado del servicio.
  - Estado de base de datos.
  - Ultimo backup.
  - Numero de usuarios aprobados, pendientes, admins.
  - Actividades futuras.
  - Items activos en catalogo.
  - Prestamos activos/vencidos si el dato es barato de calcular.
  - Feedback recibido pendiente de revisar si se implementa estado de revision.
  - Solicitudes de alta web pendientes.
- Navegacion por secciones:
  - Dashboard.
  - Web publica.
  - Actividades.
  - Catalogo.
  - Socios/usuarios.
  - Feedback.
  - Altas de socio.
  - Noticias/feeds.
  - Backups.
  - Servicio y logs.
  - Configuracion tecnica.
  - Recursos avanzados.

### Web publica desde admin

- Seccion `/admin/web` para editar:
  - Cabecera y textos de portada.
  - Logo e imagenes.
  - Contenido de `/club`.
  - Enlaces destacados de portada.
  - Tema activo.
- Guardar cambios con CSRF.
- Validar campos y assets.
- Previsualizar o al menos enlazar a la pagina publica actualizada.

### Backups y acciones destructivas

- Mover backups fuera del primer dashboard a `/admin/backups`.
- Crear backup puede ser accion directa con confirmacion ligera.
- Restaurar backup debe exigir confirmacion explicita:
  - Pantalla intermedia GET con resumen del archivo.
  - POST final con CSRF y campo tipo `confirm=RESTORE`.
  - Aviso visible de que puede sobrescribir base de datos/config/runtime.
- Eliminar backup debe exigir confirmacion explicita:
  - Pantalla intermedia o modal HTML simple.
  - POST final con CSRF y `confirm=DELETE`.
  - Mantener validacion de que el path existe en `listBackupArchives`.
- Acciones de servicio:
  - Reiniciar con confirmacion ligera.
  - Detener servicio con confirmacion fuerte y advertencia de impacto.
  - Cambiar token Telegram debe estar en seccion tecnica, con explicacion y
    confirmacion porque puede dejar el bot inutilizable.

### Recursos avanzados

- Mantener `/admin/resources`, pero marcarlo como avanzado.
- Evitar que sea la primera experiencia del admin.
- Revisar cada recurso con acciones peligrosas:
  - Borrado hard no debe aparecer como boton inmediato en listados.
  - Preferir desactivar/cancelar/archivar como accion principal.
  - Hard delete solo si hay pantalla de confirmacion y motivo claro.

## Sistema de temas

### Objetivo

Permitir cambiar estetica de web publica y admin sin reescribir cada pagina.

### Diseno minimo

- Extraer HTML comun a helpers de layout:
  - `renderPublicPage(...)`
  - `renderAdminPage(...)`
  - `renderNav(...)`
  - `renderFlashOrError(...)`
- Extraer CSS base y temas:
  - Opcion A: servir `/assets/base.css` y `/assets/themes/<theme>.css`.
  - Opcion B inicial: generar `<style>` desde un mapa de temas permitido.
- Usar allowlist de temas:
  - `classic`
  - `light`
  - `dark`
  - `club`
- Guardar tema activo en configuracion web persistida.
- No aceptar nombres de CSS arbitrarios por query/form.
- Aplicar el mismo sistema a paginas publicas y admin, con variantes si hace
  falta.

### Persistencia recomendada

- Crear un modulo `src/http/web-settings-store.ts`.
- Guardar configuracion en `app_metadata` con claves versionadas, o crear tabla
  dedicada si se necesita historial:
  - `http.web.settings`
  - `http.web.assets`
- Estructura inicial:

```json
{
  "theme": "classic",
  "home": {
    "headline": "...",
    "intro": "...",
    "logoAsset": null,
    "heroAsset": null,
    "featuredLinks": []
  },
  "clubInfo": {
    "summary": "...",
    "address": "...",
    "openingHours": "...",
    "contact": "...",
    "rules": "..."
  }
}
```

## Diseno tecnico propuesto

### Refactor inicial

- Dividir `src/http/admin-http-server.ts` en piezas pequenas antes de crecer:
  - `src/http/admin-http-server.ts`: arranque y routing principal.
  - `src/http/http-pages.ts`: layouts y helpers HTML.
  - `src/http/http-theme.ts`: temas y CSS.
  - `src/http/public-pages.ts`: portada, feedback, actividades, catalogo,
    club y alta.
  - `src/http/admin-pages.ts`: dashboard y secciones admin.
  - `src/http/admin-actions.ts`: acciones POST admin.
  - `src/http/web-settings-store.ts`: persistencia de configuracion web.
  - `src/http/member-signup-store.ts`: solicitudes de alta web si se crea
    tabla dedicada.
- Mantener `escapeHtml` y helpers de formularios centralizados.
- Evitar dependencias frontend pesadas; el panel sigue siendo HTML server-side.

### Rutas publicas esperadas

- `GET /`
- `GET /feedback`
- `POST /feedback`
- `GET /actividades`
- `GET /catalogo`
- `GET /club`
- `GET /alta`
- `POST /alta`
- `GET /assets/...` solo para assets publicos allowlisted.

### Rutas admin esperadas

- `GET /admin`
- `GET /admin/login`
- `POST /admin/login`
- `POST /admin/logout`
- `GET /admin/web`
- `POST /admin/web`
- `POST /admin/web/assets`
- `GET /admin/feedback`
- `GET /admin/member-signups`
- `POST /admin/member-signups/:id/status` si se implementa revision.
- `GET /admin/news`
- `GET /admin/backups`
- `GET /admin/backups/:file/restore`
- `POST /admin/backups/:file/restore`
- `GET /admin/backups/:file/delete`
- `POST /admin/backups/:file/delete`
- `GET /admin/service`
- `POST /admin/service`
- `GET /admin/config`
- `POST /admin/token`
- `GET /admin/resources`
- `GET /admin/resources/:resource`
- `GET /admin/resources/:resource/:id/edit`
- `POST /admin/resources/:resource/:id/edit`

## Fases de ejecucion

### Fase 1: base web y temas

- Refactorizar helpers de pagina/layout sin cambiar comportamiento visible.
- Anadir sistema de temas allowlisted.
- Mantener rutas actuales funcionando.
- Tests:
  - `/`, `/feedback`, `/admin/login`, `/admin` siguen respondiendo.
  - El HTML incluye CSS del tema activo.
  - Tema invalido cae a default.

### Fase 2: configuracion de portada y contenido del club

- Crear store de configuracion web.
- Crear `/admin/web`.
- Editar portada, logo/hero, enlaces, tema y contenido de `/club`.
- Crear `/club`.
- Tests:
  - Cambios admin persisten.
  - Salida HTML escapa contenido de usuario.
  - Assets invalidos se rechazan.

### Fase 3: secciones publicas de actividades y catalogo

- Crear `/actividades` desde `schedule_events`.
- Crear `/catalogo` desde `catalog_items`, con busqueda/filtro/paginacion.
- Reutilizar repositorios existentes o crear consultas HTTP especificas si el
  rendimiento lo requiere.
- Tests:
  - Actividades futuras visibles; canceladas ocultas.
  - Catalogo muestra activos y oculta deactivados.
  - Busqueda y filtros funcionan.
  - No se exponen acciones admin en paginas publicas.

### Fase 4: alta de socio web y feed `nuevos_miembros`

- Crear formulario `/alta`.
- Persistir solicitudes.
- Anadir categoria `nuevos_miembros`.
- Notificar por privado a todos los admins aprobados.
- Notificar a grupos suscritos al feed `nuevos_miembros`.
- Tests:
  - Solicitud valida se guarda.
  - Campos obligatorios y limites se validan.
  - Admins aprobados reciben mensaje; no admins no reciben.
  - Grupos suscritos al feed reciben mensaje.
  - Fallos parciales de Telegram no rompen la confirmacion publica.

### Fase 5: dashboard admin por secciones

- Convertir `/admin` en dashboard de estadisticas.
- Mover servicio, logs, backups, config y recursos a secciones dedicadas.
- Crear navegacion admin persistente.
- Tests:
  - Dashboard muestra metricas principales.
  - Secciones admin requieren login.
  - Logout y CSRF siguen protegidos.

### Fase 6: confirmaciones fuertes para acciones sensibles

- Restaurar backup con pantalla de confirmacion.
- Eliminar backup con pantalla de confirmacion.
- Detener servicio y cambiar token con confirmacion explicita.
- Revisar hard delete en recursos avanzados.
- Tests:
  - POST directo sin confirmacion falla.
  - CSRF sigue requerido.
  - Path de backup sigue validado contra `listBackupArchives`.
  - Acciones no destructivas siguen siendo ergonomicas.

### Fase 7: inventario, documentacion y validacion real

- Actualizar `docs/feature-status.md`:
  - Panel web pasa de bienvenida/admin basicos a web publica configurable,
    secciones publicas, alta de socio y admin por secciones.
  - Anadir feed `nuevos_miembros` en grupos de noticias.
- Actualizar docs operativas si cambian rutas o archivos persistidos.
- Ejecutar:
  - `node --import tsx --test src/http/admin-http-server.test.ts`
  - tests nuevos de stores/notificaciones HTTP.
  - tests de `/news` afectados por la nueva categoria.
  - `npm run typecheck`
  - `./scripts/feature-status-audit.sh`
  - `./startup.sh`
- Comprobar despues:
  - `https://cawa.hopto.org/`
  - `https://cawa.hopto.org/feedback`
  - `https://cawa.hopto.org/admin`
  - nuevas rutas publicas.

## Criterios de aceptacion

- La portada publica no esta hardcodeada: se puede cambiar cabecera, textos,
  logos/imagenes y tema desde `/admin`.
- La portada enlaza a admin, feedback, actividades, catalogo, club y alta como
  socio.
- `/actividades` muestra horarios reales de proximas actividades.
- `/catalogo` muestra juegos y libros activos con busqueda/filtro basico.
- `/club` muestra informacion configurable del club.
- `/alta` guarda solicitudes y notifica a admins aprobados y grupos suscritos a
  `nuevos_miembros`.
- `/news` permite gestionar el feed `nuevos_miembros`.
- `/admin` abre con dashboard de estadisticas e informacion relevante.
- Operaciones destructivas o peligrosas requieren confirmacion explicita.
- El sistema de temas se aplica a web publica y admin mediante CSS seleccionable
  allowlisted.
- No se exponen secretos, hashes ni tokens en HTML, logs o respuestas.
- Las acciones admin POST mantienen CSRF y sesiones firmadas.
- `docs/feature-status.md` queda actualizado.
- La validacion indicada pasa y `./startup.sh` deja el servicio listo para
  probar en Telegram y en la web publica.

## Riesgos y decisiones pendientes

- Persistencia de configuracion web: `app_metadata` es mas rapido para empezar;
  tabla dedicada es mejor si se quiere historial, auditoria o uploads ricos.
- Assets publicos: hay que decidir limites de tamano y tipos permitidos antes
  de aceptar subidas.
- Alta web vs `/access`: conviene decidir si las altas web solo notifican o si
  tambien crean registros `users` en estado `pending`.
- Catalogo publico con imagenes: algunas medias pueden ser URLs internas de
  Storage/Telegram; hay que confirmar cuales son publicamente servibles antes
  de renderizarlas como imagen directa.
- Legal/privacidad: el formulario de alta deberia incluir el texto minimo que el
  club quiera mostrar antes de recoger datos personales.
