# Public Schedule Events Design

## Objetivo

Permitir que una actividad de agenda se marque como pública para que pueda
publicarse también en canales o topics públicos y para que usuarios de Telegram
que todavía no son socios puedan ver la información y apuntarse.

La agenda interna no cambia: una actividad pública sigue apareciendo en las
listas y snapshots actuales de `events`. La publicación pública es un feed
adicional, filtrado sólo a actividades públicas.

## Decisiones

- Una actividad pública debe ser una mesa abierta. Las mesas cerradas no pueden
  marcarse como públicas.
- La publicación pública reutiliza el sistema `/news` existente con una categoría
  nueva, no suscrita por defecto.
- La inscripción de no socios no aprueba ni convierte al usuario en socio. Sólo
  lo añade como participante de esa actividad pública.
- Los enlaces de detalle e inscripción existentes se mantienen. El servidor
  decide si el usuario no aprobado puede continuar según el evento enlazado.
- La edición/cancelación sigue restringida a admins, permisos de gestión u
  organizador/creador según las reglas actuales.

## Modelo de datos

`schedule_events` añade:

- `is_public boolean not null default false`

El modelo de dominio `ScheduleEventRecord` expone `isPublic: boolean`. Las
entradas existentes migran como privadas.

`createScheduleEvent` y `updateScheduleEvent` aceptan `isPublic`. La validación
de dominio rechaza `isPublic = true` si `attendanceMode !== 'open'`.

## Categoría de noticias

`src/news/news-group-catalog.ts` añade una categoría:

- key: `public-events`
- aliases: `public-events`, `eventos-publicos`, `actividades-publicas`,
  `activitats-publiques`, `public`
- defaultSubscribed: `false`
- descripción: actividades públicas abiertas a personas no socias

La categoría usa el almacenamiento actual de `news_group_subscriptions`, así que
funciona igual en grupos completos, topics y canales cuando el bot puede
publicar allí.

## Publicación

`publishCalendarSnapshotToNewsGroups` mantiene la publicación actual a `events`
sin filtros nuevos.

El mismo guardado/cancelación de agenda dispara además una publicación a
`public-events`:

- carga las próximas entradas de calendario
- conserva sólo entradas `kind = 'schedule'` con `isPublic = true`
- usa el mismo formato de lista que el calendario actual
- usa un título/vacío propio para calendario público
- recuerda y sustituye el snapshot anterior por destino de forma independiente

Las claves de snapshot deben distinguir categoría para no pisar el snapshot
interno:

- `telegram.schedule.calendar_snapshot:events:<chatId>:<topicOrZero>`
- `telegram.schedule.calendar_snapshot:public-events:<chatId>:<topicOrZero>`

La limpieza sigue siendo best-effort: si Telegram no permite borrar el snapshot
anterior, se intenta editar a `...` y se registra warning estructurado.

## Flujo de creación y edición

Creación privada:

1. El usuario crea una actividad como ahora.
2. Después de elegir tipo de asistencia:
   - si elige mesa abierta, se pregunta si la actividad es pública.
   - si elige mesa cerrada, la actividad queda privada y no se pregunta.
3. El resumen de confirmación muestra si es pública o sólo para socios.

Edición:

- El menú de campos incluye "Visibilidad" o "Actividad pública" sólo para mesas
  abiertas.
- En mesas cerradas no se ofrece la edición de visibilidad pública.
- Si una edición futura permitiese cambiar una actividad pública a cerrada, debe
  desmarcar `isPublic` o rechazar la combinación antes de persistir.

## Acceso por deep link

Los comandos `/start schedule_event_<id>` y `/start schedule_details_<id>` se
mantienen públicos a nivel de comando, pero el handler aplica estas reglas:

- socio aprobado: acceso actual completo
- no socio y actividad pública programada: puede ver la ficha, ver detalles y
  apuntarse
- no socio y actividad privada/cancelada/inexistente: no entra al flujo de
  agenda; se mantiene el comportamiento público normal del bot

Los callbacks de agenda se relajan sólo para:

- inspeccionar actividad pública
- apuntarse a actividad pública abierta
- configurar recordatorio tras apuntarse a actividad pública

No se relajan:

- salir de actividades privadas
- editar
- cancelar
- menús generales de agenda
- creación de actividades

## Participantes no socios

El middleware de runtime ya sincroniza el perfil básico de Telegram en `users`.
Al apuntarse a una actividad pública, el participante no socio se guarda en
`schedule_event_participants` con su `telegram_user_id`, igual que un socio.

Las listas de asistentes y vistas admin deben seguir resolviendo nombres desde
`users`. Si el usuario no tiene nombre legible, se mantiene el fallback actual.

## Interacción con otros módulos

- Recordatorios: un no socio apuntado puede configurar recordatorio igual que un
  socio, porque el recordatorio depende de participación, no de estado de socio.
- Conflictos: las notificaciones de conflicto no deben intentar tratar al no
  socio como miembro aprobado. Si ya recibe mensajes privados del bot por haber
  iniciado el deep link, se pueden enviar con el mismo canal privado normal.
- Web `/actividades`: no es obligatorio cambiarla para la v1. Si se toca, debe
  mostrar la visibilidad pública sin exponer controles nuevos.
- LLM: la v1 no añade intent nuevo. Si más adelante se soporta `schedule.create`
  por LLM, deberá incluir la visibilidad pública.

## Pruebas

Pruebas unitarias/domain:

- crear actividad pública abierta persiste `isPublic = true`
- crear actividad pública cerrada falla
- actualizar actividad abierta a pública funciona
- actualizar actividad cerrada a pública falla
- repositorio mapea `isPublic` en create/read/update/list

Pruebas Telegram:

- wizard de creación pregunta visibilidad pública sólo para mesa abierta
- resumen de creación muestra público/privado
- usuario no aprobado puede abrir `schedule_event_<id>` de actividad pública
- usuario no aprobado no puede abrir actividad privada
- usuario no aprobado puede apuntarse a actividad pública abierta
- callback de edición/cancelación sigue bloqueado para no socios
- snapshot `events` incluye actividades públicas y privadas
- snapshot `public-events` incluye sólo actividades públicas
- snapshots `events` y `public-events` usan claves de reemplazo separadas

Validación final:

- tests focalizados de agenda/news
- `npm run typecheck`
- `npm run db:check`
- `./scripts/feature-status-audit.sh`
- `./startup.sh`

## Documentación

Actualizar `docs/feature-status.md` porque cambia:

- capacidad de agenda
- categorías `/news`
- acceso de usuarios no socios a actividades públicas
