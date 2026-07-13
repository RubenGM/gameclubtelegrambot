# Rediseño del menú de campañas y gestión de participantes

## Objetivo

Convertir el detalle privado de una partida de rol en una portada operativa basada en teclado persistente de Telegram. El creador o GM principal debe poder consultar y gestionar participantes sin depender de botones inline bajo el mensaje.

El cambio mantiene el alcance organizativo de la feature Rol: partidas, participantes, sesiones Agenda, materiales e invitaciones. No añade fichas de personaje, tiradas, combate ni asistencia narrativa.

## Decisiones de producto

- El detalle no mostrará botones inline.
- El teclado persistente agrupará la gestión en `Participantes`, `Sesiones`, `Materiales`, `Invitar` y `Configurar`.
- La portada destacará cuántas solicitudes están pendientes.
- `Participantes` mostrará por defecto miembros actuales y pendientes.
- Quienes hayan salido, sido expulsados o rechazados estarán en una vista `Historial` separada.
- El GM principal y los administradores tendrán gestión completa.
- Los coorganizadores podrán resolver solicitudes, pero no ascender, degradar ni expulsar participantes.
- Los mensajes antiguos con callbacks inline continuarán funcionando durante la transición.

## Portada de la campaña

Al abrir `/start role_game_<id>` o seleccionar una partida desde `Mis partidas`, el bot enviará el resumen de la campaña con:

- título, sistema, tipo, estado, visibilidad, plazas y descripción;
- ocupación actual sobre capacidad;
- número de solicitudes pendientes cuando sea mayor que cero;
- próxima sesión enlazada a Agenda, o indicación de que no hay ninguna programada.

Para una partida gestionable, el teclado será conceptualmente:

```text
[ Participantes · 2 pendientes ]
[ Sesiones ]        [ Materiales ]
[ Invitar ]         [ Configurar ]
[ Volver a mis partidas ]
[ Inicio ]          [ Ayuda ]
```

El contador sólo se incluirá cuando haya solicitudes pendientes. Las acciones se ocultarán cuando el actor no tenga el permiso correspondiente.

### Submenús

- `Participantes`: participantes actuales, pendientes e historial.
- `Sesiones`: próxima sesión, sesiones enlazadas y programación manual cuando corresponda.
- `Materiales`: listado y subida de handouts según permisos.
- `Invitar`: genera y muestra el enlace compartible existente.
- `Configurar`: edición de partida y recurrencia.

El botón `Solicitar plaza` para un usuario que puede apuntarse también pasará al teclado persistente. Los usuarios sin acciones de gestión recibirán una portada ajustada a sus permisos.

## Vista de participantes

El mensaje agrupará los miembros actuales por estado:

1. solicitudes pendientes;
2. lista de espera;
3. coorganizadores confirmados;
4. jugadores confirmados;
5. invitados.

Cada fila incluirá nombre visible, username cuando exista, rol y estado. Cada persona visible tendrá un botón de teclado de una fila que abre su ficha. Si dos personas producen la misma etiqueta, se añadirá información suficiente para que los botones sean inequívocos dentro de la página.

La vista tendrá paginación mediante teclado persistente según `docs/telegram-pagination-style.md`. El mensaje mostrará el pie `Mostrando X-Y de Z. Página A/B.` y sus equivalentes en catalán e inglés cuando haya más de una página. Los totales se recalcularán al renderizar.

El teclado incluirá navegación de página cuando corresponda, `Historial`, `Volver a la partida`, `Inicio` y `Ayuda`.

### Historial

La vista `Historial` incluirá estados `left`, `removed` y `rejected`. Será de sólo lectura en esta primera versión y tendrá paginación independiente. No habrá reactivación desde Telegram.

## Ficha y acciones de una persona

La ficha mostrará identidad disponible, rol, estado y fecha relevante. Las acciones dependen del estado actual:

| Estado y rol | Acciones del GM principal o admin |
|---|---|
| Solicitud pendiente | Aceptar, rechazar |
| Lista de espera | Confirmar plaza, expulsar |
| Invitado | Confirmar, cancelar invitación |
| Jugador confirmado | Hacer coorganizador, expulsar |
| Coorganizador confirmado | Convertir en jugador, expulsar |
| GM principal | Sin acciones de modificación |
| Historial | Sin acciones |

Los coorganizadores sólo verán `Aceptar` y `Rechazar` para solicitudes pendientes. No podrán cambiar roles ni expulsar.

Las acciones destructivas o de cambio de rol pedirán confirmación mediante teclado persistente. La confirmación volverá a leer partida y miembro antes de escribir para impedir que una pantalla antigua aplique una transición que ya no sea válida.

## Reglas de dominio y persistencia

Se mantendrán dos niveles de permiso:

- `canManageRoleGame`: GM principal y admin; permite configuración global, roles y expulsiones.
- `canManageRoleGameOperationally`: incluye coorganizadores confirmados; permite resolver solicitudes y operaciones ya autorizadas de sesiones y materiales.

El repositorio expondrá operaciones explícitas para cambiar el rol y realizar las nuevas transiciones de estado. La confirmación de una solicitud, invitado o persona en lista de espera deberá comprobar capacidad y escribir de forma atómica, bloqueando la partida o la fila equivalente antes de contar plazas confirmadas. Nunca se superará `capacity` por dos acciones concurrentes.

El GM principal no podrá ser degradado ni expulsado desde este flujo. Un actor tampoco podrá elevarse a sí mismo mediante etiquetas de teclado manipuladas.

## Estado conversacional y botones de teclado

El flujo guardará en la sesión activa:

- identificador de la partida;
- vista actual: portada, participantes, historial, ficha, confirmación, sesiones, materiales o configuración;
- página actual;
- mapa de etiquetas de participante de la página a identificadores internos;
- acción pendiente de confirmación, si existe.

Los textos recibidos se resolverán sólo contra el estado de sesión y los botones válidos de la pantalla actual. No se confiará en nombres visibles ni identificadores escritos libremente por el usuario.

Los callbacks inline existentes seguirán registrados. Al procesar uno, el bot volverá a comprobar estado y permisos y responderá con la nueva navegación de teclado, para que los mensajes enviados antes del despliegue no queden rotos.

## Notificaciones y errores

Después de aceptar, rechazar, expulsar o cambiar el rol, el bot intentará notificar por privado a la persona afectada con el nombre de la partida y el cambio realizado. El fallo de Telegram será best-effort: se registrará como warning estructurado y no revertirá una operación ya persistida.

Los estados obsoletos tendrán respuestas específicas:

- la persona ya no tiene el estado esperado;
- la partida está llena;
- la partida o el miembro ya no existe;
- el actor perdió el permiso;
- la acción no es válida para el GM principal.

Tras cualquiera de estos casos se recargará una pantalla segura: la ficha actualizada si sigue siendo visible o la lista de participantes.

## Internacionalización

Toda etiqueta, resumen, confirmación, error y notificación se añadirá en catalán, español e inglés dentro de la sección Rol. Los botones seguirán los roles semánticos existentes: navegación, ayuda, acción primaria, éxito y peligro.

## Compatibilidad con las features existentes

- Las sesiones continuarán reutilizando Agenda y `role_game_sessions`.
- Los materiales continuarán aislados en Storage con propósito `role_game_handouts`.
- Los enlaces `role_game_<id>` y `role_material_<id>` no cambiarán.
- Los one-shots públicos para participantes externos conservarán sus permisos actuales.
- La invitación seguirá siendo un enlace compartible y no aprobará membresías del club.

## Pruebas

La implementación seguirá TDD y cubrirá como mínimo:

- portada sin botones inline y teclado adaptado a GM, coorganizador, jugador y visitante;
- contador de solicitudes y próxima sesión;
- agrupación, orden, etiquetas inequívocas y paginación de participantes;
- separación y paginación del historial;
- apertura de ficha desde botones de teclado;
- acciones permitidas y denegadas por rol;
- confirmaciones y rechazo de pantallas obsoletas;
- ascenso a coorganizador y descenso a jugador;
- expulsión, aceptación, rechazo y cancelación de invitación;
- comprobación atómica de capacidad;
- notificación exitosa y fallo best-effort;
- compatibilidad de callbacks inline antiguos;
- regresiones de sesiones, recurrencia, materiales, invitación y acceso externo.

Al finalizar se ejecutarán los tests específicos de Rol y Storage, `npm run typecheck`, `./scripts/feature-status-audit.sh` y `./startup.sh`. Después se comprobarán el servicio y los logs si el arranque no finaliza limpiamente.

## Documentación operativa

`docs/feature-status.md` se actualizará para reflejar:

- la portada por teclado persistente;
- la gestión de participantes e historial;
- el reparto de permisos entre GM, admin y coorganizador;
- las nuevas pruebas relevantes.
