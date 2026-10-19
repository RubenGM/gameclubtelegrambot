# Foundry VTT: acceso HTTPS en la red del club

Configuración operativa verificada el 19 de octubre de 2026 con Foundry VTT
14, build 369.

## Comando del bot y edición del mensaje

`/foundry` muestra las instrucciones de conexión a socios aprobados, tanto en
privado como en grupos y topics. El comando conserva cualquier flujo activo
del usuario. El texto inicial está disponible en catalán, español e inglés e
incluye el enlace HTTPS, la selección de usuario y la indicación de contactar
con el máster si no hay una partida abierta.

En el menú privado **Admin → Foundry**, un administrador puede consultar el
mensaje actual, pulsar **Editar mensaje** y enviar el texto nuevo. Admite
hasta 3500 caracteres y conserva las entidades de formato de Telegram como
HTML seguro, incluidos enlaces, negritas y cursivas. **Previsualizar** muestra
la misma respuesta que el comando. **Cancelar edición** o `/cancel` salen sin
guardar. Los permisos de administrador se comprueban de nuevo al guardar.

La personalización se guarda en PostgreSQL, en `app_metadata` con clave
`foundry.connection_message`, y se aplica inmediatamente sin reiniciar el bot.
El mensaje personalizado es común a todos los idiomas; mientras no se haya
guardado uno, se muestra el texto inicial en el idioma del usuario.

## Acceso y topología

- Dirección pública: <https://cawa.hopto.org/foundry/>.
- Nginx recibe HTTPS en la máquina Linux del bot y reenvía las peticiones de
  Foundry a `http://192.168.1.22:30000` por la red local.
- El servidor HTTP del bot continúa en `127.0.0.1:8787`; `/`, `/feedback` y
  `/admin` conservan su comportamiento.
- Los certificados y su renovación siguen gestionados por Certbot en Linux.
- El router no se ha modificado durante esta configuración. El acceso HTTPS
  utiliza el reenvío existente del puerto 443 a Linux.

El acceso directo por la LAN pasa a ser
`http://192.168.1.22:30000/foundry/`. Los enlaces antiguos al puerto público
30000 también necesitan el prefijo `/foundry/` mientras se conserve ese reenvío.

Este despliegue proporciona acceso web a Foundry. La vinculación de mundos,
personajes o materiales con Rol todavía no está implementada en el bot.

## Configuración efectiva de Windows

El proceso que escucha en el puerto 30000 es Node.js, administrado por el
servicio Windows `FoundryVTT`, con inicio automático y cuenta `LocalService`.
Su directorio de datos efectivo es:

```text
C:\ProgramData\FoundryVTT-ServerData
```

Editar `Config/options.json` dentro de ese directorio. La copia del perfil de
escritorio `C:\Users\ruben\AppData\Local\FoundryVTT` no es la configuración
efectiva de este servicio. Los valores relacionados con el proxy son:

```json
{
  "hostname": "cawa.hopto.org",
  "routePrefix": "foundry",
  "port": 30000,
  "proxyPort": 443,
  "proxySSL": true
}
```

Este bloque es un extracto: conservar las demás opciones del archivo. Foundry
recibe HTTP en la LAN; la terminación TLS se realiza en Nginx. Tras modificar
las opciones, reiniciar el servicio `FoundryVTT`.

## Configuración de Nginx

El sitio activo está en `/etc/nginx/sites-available/gameclubtelegrambot`,
enlazado desde `sites-enabled`. Su configuración completa se administra fuera
del repositorio. El bloque `map` añadido se declara en contexto `http`, antes
del bloque `server` del sitio:

```nginx
map $http_upgrade $gameclub_foundry_connection_upgrade {
    default upgrade;
    '' close;
}
```

Dentro del `server` HTTPS se añade:

```nginx
location ~ ^/foundry(?:/|$) {
    proxy_pass http://192.168.1.22:30000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $gameclub_foundry_connection_upgrade;
    proxy_connect_timeout 10s;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    client_max_body_size 300m;
}
```

El `proxy_pass` conserva el prefijo de la petición. La expresión de ubicación
acepta `/foundry` y `/foundry/`, sin capturar rutas como `/foundry-other`.
Foundry 14 redirige la segunda forma a la primera: forzar en Nginx la redirección
inversa provoca un bucle. Los límites y las cabeceras del backend del bot
permanecen en su ubicación original.

Antes de recargar Nginx, ejecutar `sudo nginx -t`.

## Comprobaciones y recuperación

Se ha verificado:

- Acceso con certificado HTTPS válido desde la máquina Linux al dominio
  público, tanto con `/foundry` como con `/foundry/`.
- Carga de la pantalla de autenticación con `ROUTE_PREFIX="foundry"`, CSS y
  JavaScript bajo el mismo prefijo.
- Handshake Engine.IO por polling y conexión WebSocket HTTPS con respuesta
  `101 Switching Protocols`, validación de `Sec-WebSocket-Accept` y recepción
  del paquete inicial de Engine.IO.
- Portada y feedback públicos con respuesta 200; `/admin` conserva la
  redirección al login.
- Servicios Nginx, bot y Foundry activos después del cambio.

Estas comprobaciones no incluyen entrar con credenciales ni ejecutar una
partida dentro de un mundo.

Las copias previas a este cambio están en:

```text
Linux:
/var/backups/gameclub-foundry-proxy/20261019-092351/gameclubtelegrambot

Windows:
C:\ProgramData\FoundryVTT-ServerData\Config\options.json.before-https-proxy-20261019-092352
```

Para deshacer el cambio, restaurar ambas configuraciones, reiniciar el servicio
Windows y validar/recargar Nginx. Restaurar solamente una de las dos deja
descoordinado el prefijo de rutas.

Referencias oficiales: [configuración de Foundry](https://foundryvtt.com/article/configuration/)
y [proxy Nginx](https://foundryvtt.com/article/nginx/).
