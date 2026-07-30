# Google Calendar del club

La Agenda del bot es la fuente de verdad. Google Calendar es una copia de solo
salida: crear, editar o cancelar una actividad desde el bot se refleja en el
calendario seleccionado, pero las ediciones hechas directamente en Google no se
importan de vuelta al bot.

## Preparación inicial

1. En Google Cloud, crea o elige un proyecto y habilita **Google Calendar API**.
2. Crea una cuenta de servicio y descarga su clave JSON. No la subas al
   repositorio ni la envíes por Telegram.
3. En Google Calendar, comparte el calendario del club con el correo
   `client_email` de esa cuenta de servicio. Dale el permiso **Hacer cambios y
   gestionar el uso compartido**: es necesario para que el bot pueda crear
   eventos y alternar el acceso público/privado.
4. En el directorio de despliegue del bot, guarda el JSON completo como secreto
   en `config/.env`:

   ```bash
   GAMECLUB_GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   ```

5. Ejecuta `./startup.sh` para validar la configuración, copiarla al entorno del
   servicio y reiniciarlo. No lo guardes sólo en `/etc/gameclubtelegrambot/.env`,
   porque el despliegue lo regenera.

El secreto también está disponible en `npm run config:edit`, dentro de la
sección **Google Calendar**. Nunca se persiste en `runtime.json`, en
`app_metadata` ni en los logs.

## Administración desde Telegram

Un administrador abre `Inicio → Admin → Calendar Google` o ejecuta
`/google_calendar`. Desde ahí puede:

- Seleccionar uno de los calendarios accesibles por la cuenta de servicio, o
  introducir su ID/enlace con `cid`.
- Cambiar la accesibilidad entre privado (valor por defecto) y público. Este
  cambio afecta al permiso público del calendario de Google; no altera el campo
  «actividad pública» propio de la Agenda.
- Iniciar o detener la sincronización automática. Al iniciarla se copian todas
  las actividades futuras existentes; detenerla no borra los eventos ya
  publicados.

La selección se guarda en `app_metadata`, no en `runtime.json`. Sin configuración
previa, los valores seguros son calendario no seleccionado, visibilidad privada
y sincronización detenida. Los cambios de visibilidad y el inicio o parada
requieren confirmación en el flujo administrativo.

Cuando la sincronización está activa, la Agenda envía de inmediato altas,
cambios y cancelaciones. Además, una reconciliación cada cinco minutos repite
las actividades futuras y las cancelaciones recientes para recuperar fallos
temporales y rutas automáticas como sesiones recurrentes de Rol. La ventana
actual empieza 24 horas antes de cada reconciliación para incluir cancelaciones
recientes.

Un fallo inmediato de Google no revierte la operación ya confirmada en Agenda:
queda registrado y la reconciliación posterior vuelve a intentarlo. Al detener
la sincronización, cambiar de calendario o volverlo privado no se borran
automáticamente las copias antiguas; cualquier limpieza histórica debe hacerse
de forma deliberada en Google Calendar.

## Enlace desde grupos

En un grupo o topic donde el bot esté presente, cualquier usuario puede escribir
exactamente `@cawa_management_bot calendar` (el username real se resuelve en
tiempo de ejecución). El bot publica el enlace del calendario configurado en el
mismo destino e intenta borrar el mensaje disparador. Si no tiene permiso de
borrar mensajes, conserva la respuesta y registra el fallo internamente.

Un enlace no concede acceso a un calendario privado. Para socios concretos, el
administrador debe compartirlo desde Google Calendar —preferiblemente con un
Google Group de socios que quieran recibirlo— o hacerlo público desde el menú
del bot.

## Diagnóstico y validación

Para cambios en la integración, valida como mínimo:

```bash
node --import tsx --test src/google-calendar/google-calendar-settings.test.ts src/google-calendar/google-calendar-sync.test.ts src/telegram/google-calendar-public-link-flow.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
./scripts/service-journal.sh -n 200
```

La selección, confirmaciones y mensajes del flujo admin deben comprobarse
también manualmente; actualmente no existe un test enfocado de
`google-calendar-admin-flow.ts`.

Esta validación local cubre contratos, persistencia, sincronización simulada,
despliegue y arranque. No prueba credenciales ni operaciones reales de Google.
La verificación externa sigue pendiente hasta compartir un calendario real con
el `client_email`, seleccionarlo, activar la sincronización y confirmar en
Google una creación, una edición, una cancelación, la visibilidad y el enlace
desde un grupo o topic.
