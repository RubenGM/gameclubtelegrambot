# Admin Console TUI

La consola de administracion es una TUI local basada en Textual para operar el servicio, revisar configuracion y gestionar contenido persistido en PostgreSQL.

## Arranque

Desde una terminal interactiva:

```bash
./scripts/admin-console.sh
```

Desde npm:

```bash
npm run admin:console
```

Desde SSH fuerza pseudo-terminal:

```bash
ssh -t usuario@host 'cd /home/cawa/telegrambot/gameclubtelegrambot && npm run admin:console'
```

Opciones del launcher:

```bash
./scripts/admin-console.sh --service-name gameclubtelegrambot.service --poll-ms 8000
./scripts/admin-console.sh --config config/runtime.local.json --env config/.env
./scripts/admin-console.sh --operator-id 123456789
```

La TUI requiere `stdin` y `stdout` interactivos. Si se ejecuta desde cron, pipe o una sesion SSH sin `-t`, el launcher termina con un mensaje explicito.

El launcher crea un entorno Python local en `.venv-admin-console` e instala `requirements-admin-console.txt` la primera vez. En Debian/Ubuntu puede requerir:

```bash
sudo apt-get install -y python3-venv python3-pip
```

## Vistas

- `1 Resumen`: estado general de servicio, DB, usuarios y contenido.
- `2 Config`: rutas y contenido cargado de runtime JSON y `.env`.
- `3 Contingut`: contadores de catalogo, storage, agenda, sala y compras.
- `4 Usuaris`: usuarios pendientes, con acciones rapidas de aprobacion/bloqueo/revocacion.
- `5 Admins`: administradores actuales.
- `6 Recursos`: navegador y editor de tablas soportadas.
- `7 Missatges`: actividad reciente de audit log y mensajes de storage.
- `8 DB`: resumen de conexion y tablas.
- `9 Logs`: logs recientes de systemd para el servicio configurado.

## Teclas

- Click en la columna izquierda: cambiar de vista.
- Click en un tipo de recurso: cambiar la tabla gestionada.
- Click en una fila: seleccionar y cargar detalle.
- Rueda del raton sobre listas o detalle: scroll.
- `q`: salir.
- `1` a `9`: cambiar de vista.
- `r`: refrescar datos.
- `Tab`: foco principal de la vista.
- `PageUp` / `PageDown`: scroll del panel de detalle.
- `g` / `G`: ir al inicio/final del detalle.
- `?`: ayuda contextual.
- `s`: iniciar servicio systemd.
- `x`: parar servicio systemd.
- `S`: reiniciar servicio systemd.

En `Usuaris` y `Admins`:

- `o`: aprobar usuario.
- `p`: devolver a pending.
- `b`: bloquear.
- `v`: revocar.
- `a`: alternar admin.

En `Recursos`:

- `c`: siguiente tipo de recurso.
- `C`: tipo de recurso anterior.
- `/`: filtrar por texto.
- `Enter`: cargar detalle de la fila seleccionada.
- `e`: editar un campo permitido.
- `d`: desactivar, cancelar, archivar o marcar como eliminado cuando la tabla tiene semantica de borrado blando.
- `D`: borrar definitivamente la fila de PostgreSQL.

## Recursos Gestionables

La vista `Recursos` permite listar, buscar, ver detalle, editar campos permitidos y borrar filas de estas areas:

- Usuarios y permisos basicos: `users`.
- Catalogo: `catalog_families`, `catalog_groups`, `catalog_items`, `catalog_media`, `catalog_loans`.
- Mesas y agenda: `club_tables`, `schedule_events`, `schedule_event_participants`, `venue_events`.
- Noticias: `news_groups`.
- Compras de grupo: `group_purchases`, `group_purchase_fields`, `group_purchase_messages`.
- LFG: `lfg_player_ads`, `lfg_group_ads`.
- Storage: `storage_categories`, `storage_entries`, `storage_entry_messages`.
- Auditoria: `audit_log` como lectura.

Los campos editables estan whitelisteados por recurso. No se expone edicion libre de SQL desde la TUI.

## Borrado

`d` intenta usar el borrado blando del dominio cuando existe:

- Catalogo: marca `lifecycle_status` como `inactive`.
- Actividades y ocupaciones de sala: marca `lifecycle_status` como `cancelled`.
- Storage: archiva categorias o marca entradas como `deleted`.
- Prestamos: marca `returned_at`.
- LFG: marca anuncios como `cancelled`.

`D` ejecuta `delete from ...` sobre la fila seleccionada. Esto puede fallar si hay claves foraneas dependientes y debe usarse solo cuando se quiere eliminar la fila de base de datos.

## Seguridad Operativa

- El gestor usa la configuracion runtime normal del bot (`GAMECLUB_CONFIG_PATH` y `GAMECLUB_ENV_PATH`).
- Las acciones de servicio usan `systemctl` y `journalctl` sobre `GAMECLUB_SERVICE_NAME`.
- Las acciones de usuario y algunos borrados blandos registran el operador con `GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID`.
- La edicion de recursos usa una lista cerrada de tablas y columnas; no acepta nombres de tabla o columna desde entrada libre.

## Limitaciones

- La TUI no sustituye las validaciones de negocio complejas de los flujos de Telegram. Permite operacion directa para mantenimiento.
- El editor de campos trabaja con valores escalares, fechas y JSON. Para estructuras grandes es preferible editar mediante herramientas especializadas o flujos del bot.
- El borrado definitivo puede quedar bloqueado por integridad referencial de PostgreSQL.
- Las tablas con clave compuesta sin identificador unico simple, como algunas relaciones de suscripcion o participantes, no se editan todavia desde el gestor generico para evitar actualizaciones ambiguas.
