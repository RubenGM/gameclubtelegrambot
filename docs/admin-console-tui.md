# Admin Console Textual

La consola de administracion oficial del proyecto es la TUI Python/Textual lanzada por:

```bash
./scripts/admin-console.sh
```

El mantenimiento futuro de la consola debe hacerse sobre:

- `scripts/admin-console.sh`: launcher, entorno virtual y argumentos.
- `scripts/admin-console-textual.py`: aplicacion Textual.
- `requirements-admin-console.txt`: dependencias Python.

## Arranque

Desde el repo:

```bash
./scripts/admin-console.sh
```

Desde npm:

```bash
npm run admin:console
```

Desde SSH:

```bash
ssh -t usuario@host 'cd /home/cawa/telegrambot/gameclubtelegrambot && npm run admin:console'
```

Opciones soportadas:

```bash
./scripts/admin-console.sh --service-name gameclubtelegrambot.service
./scripts/admin-console.sh --config /etc/gameclubtelegrambot/runtime.json --env /etc/gameclubtelegrambot/.env
./scripts/admin-console.sh --operator-id 123456789
```

El launcher requiere una terminal interactiva. Si falta el entorno Python local, crea `.venv-admin-console` e instala `requirements-admin-console.txt`. En Debian/Ubuntu puede hacer falta:

```bash
sudo apt-get install -y python3-venv python3-pip
```

## Vistas

La vista activa se cambia desde el selector `Vista` del lateral:

- `Resumen`: estado del servicio, base de datos y contadores principales.
- `Config`: rutas runtime, bot activo, accion de cambio de token y recordatorio de backup.
- `Backups`: lista de backups completos disponibles.
- Recursos de base de datos: usuarios, catalogo, mesas, agenda, sala, noticias, compras, LFG, storage y auditoria.

La TUI usa una tabla central para listar datos y un panel de detalle para la fila o vista seleccionada.

## Cambiar De Bot

Para aplicar un token nuevo de BotFather:

1. Abre `./scripts/admin-console.sh`.
2. En el selector `Vista`, elige `Config`.
3. Pulsa `t` o el boton `Cambiar token bot`.
4. Pega el token nuevo.
5. Confirma.
6. Pulsa `S` o el boton `Restart servicio`.

La consola actualiza solo `GAMECLUB_TELEGRAM_TOKEN` en el `.env` runtime resuelto. No escribe el token en `runtime.json`.

## Backups

La vista `Backups` opera sobre el directorio resuelto por este orden:

1. `GAMECLUB_BACKUP_DIR`, si existe.
2. `/var/backups/gameclubtelegrambot`, si existe.
3. `<repo>/backups`.

Acciones:

- `b` o `Crear backup`: crea un backup completo.
- `R` o `Restaurar backup`: restaura el zip seleccionado.
- `Eliminar backup`: borra el zip seleccionado.

El backup completo cubre:

- `runtime.json`
- runtime `.env`, guardado dentro del zip como `config/runtime.env`
- `/etc/default/gameclubtelegrambot`, guardado como `config/default.env`
- dump PostgreSQL
- unidad systemd y regla polkit si existen

En instalaciones Debian, `/var/backups/gameclubtelegrambot` debe quedar como:

```text
gameclubbot:gameclubbot-operators 2770
```

El bit setgid mantiene los nuevos backups dentro del grupo operador. No uses `chmod 777`: el servicio de backup recrea permisos controlados.

## Teclas

- `q`: salir.
- `r`: refrescar.
- `e`: editar campo en recursos editables.
- `space`: seleccionar o deseleccionar una fila para acciones por lote.
- `c`: limpiar seleccion.
- `d`: borrado blando cuando el recurso lo soporta.
- `D`: borrado definitivo.
- `b`: crear backup.
- `R`: restaurar backup seleccionado.
- `t`: cambiar token del bot.
- `s`: iniciar servicio.
- `x`: parar servicio.
- `S`: reiniciar servicio.

## Recursos Gestionables

La consola permite listar, buscar, ver detalle, editar campos permitidos y borrar filas de recursos whitelisteados. No ejecuta SQL libre desde la entrada del operador.

Areas principales:

- Usuarios: aprobacion, bloqueo, revocacion y admin.
- Catalogo: familias, grupos, items, media y prestamos.
- Mesas y agenda: mesas, actividades, participantes y ocupaciones de sala.
- Noticias: grupos habilitados.
- Compras: compras, campos y mensajes.
- LFG: anuncios de jugadores y grupos.
- Storage: categorias, entradas y mensajes.
- Auditoria: lectura.

## Seguridad Operativa

- La consola usa `GAMECLUB_CONFIG_PATH` y `GAMECLUB_ENV_PATH`, o las rutas pasadas por `--config` y `--env`.
- Las acciones de servicio llaman a `systemctl` sobre `GAMECLUB_SERVICE_NAME`.
- Las acciones de backup llaman a `scripts/backup-cli.sh`.
- Las acciones de usuario registran `GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID` cuando aplica.
- Los secretos no deben mostrarse completos en pantalla ni escribirse en `runtime.json`.

## Mantenimiento

Al extender la consola:

- Mantener la implementacion en Python/Textual.
- Actualizar esta documentacion si cambia una vista, tecla o flujo operativo.
- Preferir botones laterales para operaciones frecuentes y teclas para acciones repetidas.
- Mantener una lista cerrada de tablas y campos editables.
- Validar cambios con:

```bash
python3 -m py_compile scripts/admin-console-textual.py
bash -n scripts/admin-console.sh
npm run lint
```
