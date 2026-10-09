# Creación de actividades por Telegram

La creación se inicia desde `Actividades → Crear actividad`, `Crear (simple)`
o desde una ficha de catálogo. Requiere un socio aprobado y se realiza por
privado. La Agenda conserva la autoridad sobre las reservas.

## Borrador y revisión

El flujo completo recoge título, fecha, hora, plazas y recursos; el resumen
permite ajustar también duración, tipo de mesa y descripción con adjuntos.
En mesas abiertas se pueden configurar visibilidad y plazas inicialmente
ocupadas. El modo simple recoge los cinco datos básicos, conserva por defecto
180 minutos, visibilidad sólo para socios y ningún recurso, y termina también
en una revisión: introducir las plazas no publica la actividad.

`Guardar actividad` es la confirmación explícita. Desde la revisión se puede
cambiar cada dato sin rehacer todo el recorrido. Las plazas inicialmente
ocupadas no pueden superar el aforo; sólo las mesas abiertas admiten
visibilidad pública y reservas iniciales.

`Atrás` conserva el borrador, incluidos juego enlazado, descripción, adjuntos
y recursos seleccionados. `Salir a Agenda` abandona la creación. Las opciones
rápidas de fecha, hora y plazas admiten también escritura manual.

El flujo completo usa inicialmente 120 minutos. Los textos muestran la duración
efectiva: una reserva de dos horas no se presenta como «sin duración».

## Presentación y disponibilidad

La Agenda del día, el resumen, los selectores de recursos y el recibo usan
mensajes rich cuando el transporte está disponible. El calendario comparte la
tabla móvil de dos columnas y dos filas por actividad. Todos conservan una
alternativa convencional completa para clientes o APIs sin soporte.

Debajo de la hora, la primera columna muestra el aforo (`4 plazas`) alineado
a la derecha y añade
`🔒` en mesas cerradas (`4 plazas 🔒`), con el texto localizado. La segunda
columna reserva el espacio inferior para mesa, equipamiento y detalles.
El rango horario va en negrita. El título enlazado añade `ℹ️` si hay descripción
o mensaje extra; la tabla no repite previews, `Ver detalles` ni `Ver descripción`.
La información completa se consulta desde la ficha. Los eventos del local sin
enlace conservan la descripción en la tabla.

La selección de mesas y equipamiento muestra disponibilidad para el intervalo
del borrador. Los solapes ordinarios son avisos y permiten continuar; las
actividades prioritarias reservan el club y siguen bloqueando escrituras
incompatibles. La disponibilidad es informativa y no sustituye las
comprobaciones al guardar.

## Guardado y procesos posteriores

Una vez persistida la actividad, el bot confirma el guardado y muestra un
progreso editable durante sincronización con Google Calendar, avisos de
conflicto y publicación de calendarios. Los fallos posteriores no convierten
una actividad guardada en un aparente fallo de creación.

Los controles de reply keyboard se envían aparte de las ediciones; las
ediciones de Telegram sólo admiten inline keyboard. Si falla una edición,
el resultado final se entrega mediante un mensaje nuevo.

## Validación

La cobertura de Agenda incluye creación completa y simple, corrección desde
el resumen, retrocesos, límites de ocupación, selección de recursos, rich y
fallback, y fallos posteriores al guardado. Los textos se mantienen en
catalán, castellano e inglés.

Referencias: [inventario](feature-status.md),
[paginación](telegram-pagination-style.md) y
[progreso editable](telegram-editable-progress.md).
