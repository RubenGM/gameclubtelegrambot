# Diseño de gestión de personajes de Rol

**Fecha:** 2026-07-14

**Objetivo:** Añadir a cada partida de Rol una gestión completa de personajes y adjuntos privados, con propiedad transferible entre miembros confirmados, solicitudes de personajes libres y desasignación automática cuando un miembro abandona la partida o es expulsado.

## Alcance

La feature amplía el dashboard privado de cada partida con una sección persistente `Personajes`. Permite crear varios personajes por miembro, consultar personajes propios o compartidos, gestionar adjuntos, solicitar personajes libres y transferir su asignación sin duplicar las capacidades generales de Participantes ni Storage.

Quedan fuera de alcance:

- fichas estructuradas por sistema de juego;
- borrado de personajes;
- reactivación de membresías históricas;
- exposición de personajes o adjuntos en grupos públicos;
- acceso a adjuntos desde la UI genérica de Storage;
- migración de personajes anteriores, porque la feature todavía no tiene datos reales.

## Arquitectura

Los personajes tendrán un dominio y repositorio propios, separados del catálogo general de partidas. Esta separación evita seguir ampliando `RoleGameRepository`, permite probar permisos y transiciones de propiedad de forma aislada y mantiene el flujo Telegram de personajes fuera del ya extenso `role-game-flow.ts`.

La solución se divide en cuatro unidades:

1. `role-game-character-catalog.ts`: tipos, normalización, permisos y operaciones de dominio.
2. `role-game-character-store.ts`: persistencia Drizzle, bloqueos y transiciones atómicas.
3. `role-game-character-flow.ts`: navegación y sesiones conversacionales de Telegram.
4. `role-game-character-keyboards.ts`: teclados persistentes y paginación específica.

El catálogo existente de partidas seguirá siendo responsable del ciclo de vida de los miembros. Cuando un miembro confirmado pase a `left` o `removed`, su cambio de estado y la desasignación de todos sus personajes se ejecutarán en una misma transacción.

## Modelo de datos

### Personajes

`role_game_characters` contendrá:

- referencia a `role_games`;
- referencia nullable a `role_game_members` como propietario actual;
- nombre normalizado, obligatorio y limitado a 120 caracteres;
- descripción opcional limitada a 3000 caracteres;
- URL opcional limitada a 2048 caracteres y restringida a `http:` o `https:`;
- visibilidad `players` o `private`;
- creador y marcas temporales de creación, actualización, asignación y desasignación.

La propiedad sigue a `role_game_members.id`, no al Telegram user ID. Cualquier miembro `confirmed` puede ser propietario, independientemente de que su rol sea `player`, `coorganizer` o `primary_gm`.

La migración eliminará `role_game_members.character_name`, ya que no hay personajes reales que convertir y mantener ese campo crearía dos fuentes de verdad. `role_game_members.player_note` se conserva porque representa una nota sobre el participante, no la descripción de un personaje.

### Adjuntos

`role_game_character_attachments` enlazará cada adjunto lógico con una entrada individual de Storage interno. Guardará:

- personaje;
- entrada Storage actual, con unicidad global;
- visibilidad `players` o `private`;
- usuario que lo subió;
- marcas temporales de creación, actualización y retirada lógica.

Cada documento, foto, vídeo o audio de Telegram constituye un adjunto independiente. No habrá límite de producto; las listas se paginarán.

### Solicitudes

`role_game_character_claim_requests` guardará solicitudes de miembros confirmados sobre personajes públicos libres, con estados `requested`, `approved`, `rejected` y `cancelled`.

Sólo puede existir una solicitud pendiente por pareja personaje-miembro. La aprobación asignará el personaje y cancelará en la misma transacción las solicitudes rivales que sigan pendientes.

## Permisos

Se reutilizan las fronteras existentes:

- `canManageRoleGame` continúa reservado para configuración global de la partida.
- `canManageRoleGameOperationally` define las operaciones de GM sobre personajes y comprende admin global, GM principal y coorganizador confirmado.

Todo miembro confirmado puede:

- crear uno o más personajes asignados a sí mismo;
- editar sus propios personajes;
- ver personajes `players` de la partida;
- solicitar personajes `players` que estén libres;
- cancelar sus propias solicitudes;
- abandonar cualquiera de sus personajes;
- añadir, reemplazar, retirar y cambiar la privacidad de sus adjuntos.

Un GM puede además:

- crear personajes libres o asignados a cualquier miembro confirmado;
- editar cualquier personaje de la partida;
- asignar, desasignar o transferir directamente un personaje;
- gestionar cualquier adjunto;
- aprobar o rechazar solicitudes.

Promover o degradar a un miembro no cambia sus personajes. Pasarlo a `left` o `removed` desasigna todos sus personajes dentro de la misma transacción. Los estados pendientes, rechazados o históricos no pueden recibir ni solicitar personajes.

## Visibilidad

Un personaje `players` es visible para todos los miembros confirmados de la partida. Un personaje `private` sólo es visible para su propietario actual y los GM. Un personaje privado sin propietario sólo es visible para los GM y no admite solicitudes.

Un adjunto `players` hereda la audiencia efectiva del personaje. Un adjunto `private` sólo es visible para el propietario actual y los GM. La visibilidad siempre se calcula después de recargar personaje, partida y membresía; nunca se confía únicamente en datos guardados en sesión.

El deep link nuevo `role_character_<id>` sólo abre el detalle del personaje después de recalcular permisos. Los adjuntos se abren dentro de la sesión de Personajes mediante selecciones session-safe; no se reutiliza `role_material_<id>`, que continúa reservado a los handouts generales de partida existentes. Ante un recurso inexistente, privado o perteneciente a otra partida, la respuesta no revela el nombre ni confirma su existencia.

## Transiciones y concurrencia

Asignar, transferir, desasignar, aprobar solicitudes y cambiar privacidad utilizará una transacción con bloqueos `FOR UPDATE` y condiciones compare-and-set.

La transferencia directa de A a B será una única operación atómica. Comprobará que el personaje sigue asignado a A, que B sigue siendo miembro confirmado de la misma partida y que el actor conserva permisos de GM. Al completarse actualizará propietario y marcas temporales y cancelará solicitudes pendientes incompatibles.

Una asignación directa y una aprobación de solicitud compartirán la misma primitiva interna del store para evitar reglas divergentes. Ninguna carrera puede producir dos propietarios, aprobar dos solicitudes rivales ni mostrar un recibo de éxito para una escritura no confirmada.

## Storage interno

Los adjuntos reutilizarán la categoría oculta con `categoryPurpose = 'role_game_handouts'`. Cada adjunto tendrá su propia entrada Storage, pero su ciclo de vida se gestionará exclusivamente desde Rol.

La creación y el reemplazo se orquestan así:

1. copiar el archivo y persistir la entrada Storage nueva;
2. crear o intercambiar el enlace lógico mediante compare-and-set;
3. si el enlace falla, retirar la entrada nueva para evitar huérfanos;
4. después de un intercambio confirmado, retirar best-effort la entrada anterior;
5. registrar cualquier fallo de limpieza para reintento sin revertir el nuevo enlace confirmado.

Al retirar un adjunto se ocultará primero desde el dominio de Rol y después se retirará best-effort la entrada Storage. Un fallo de limpieza no podrá volver a exponerlo.

La frontera genérica de Storage rechazará listado, búsqueda, detalle directo, edición, borrado, tags e impresión de estas entradas, incluso para admins o usuarios con permisos globales de Storage o impresión.

## Experiencia Telegram

La sección `Personajes` aparecerá en el dashboard de partida para miembros confirmados y GM. Usará teclado de respuesta persistente y ofrecerá:

- `Mis personajes`;
- `Personajes de la partida`;
- `Personajes libres`;
- `Crear personaje`;
- para GM, `Solicitudes de personaje` y acciones de asignación.

Las listas mostrarán seis elementos por página, recalcularán totales al renderizar, acotarán páginas inválidas y mostrarán únicamente controles válidos. Los detalles se abrirán mediante deep links en el cuerpo del mensaje. Los nombres duplicados se desambiguarán con `· #ID` y las selecciones por teclado se resolverán mediante mapas de sesión que rechacen texto fabricado.

La creación será un wizard cancelable para nombre, descripción opcional, URL opcional, privacidad y confirmación. Los GM elegirán además propietario confirmado o personaje libre mediante listas paginadas, nunca escribiendo Telegram IDs.

Cada adjunto se cargará de uno en uno. Tras recibir documento, foto, vídeo o audio, el bot elegirá su privacidad y regresará al detalle, desde donde podrán añadirse más adjuntos sin límite.

Todas las acciones visibles y mensajes estarán localizados en catalán, español e inglés con ortografía natural.

## Errores y notificaciones

Cada escritura recargará partida, actor, membresías implicadas, personaje y estado esperado. Si una sesión queda obsoleta por una acción concurrente, el flujo limpiará la acción pendiente, volverá a la vista vigente y mostrará una explicación localizada.

Las asignaciones, transferencias, aprobaciones, rechazos y desasignaciones producirán notificaciones privadas best-effort. Los fallos Telegram se registrarán mediante warnings estructurados y nunca revertirán una escritura ya confirmada.

## Estrategia de pruebas

La implementación seguirá TDD por capas:

- pruebas puras de normalización, permisos y visibilidad;
- pruebas del store para bloqueos, compare-and-set, transferencias y solicitudes rivales;
- pruebas de integración del ciclo de miembro para `left` y `removed`;
- pruebas de aislamiento de Storage frente a acciones genéricas y callbacks fabricados;
- pruebas de Telegram para navegación, paginación, deep links, wizards, pérdida de permisos y sesiones obsoletas;
- regresión completa de Rol y Storage;
- `npm run db:check`, `npm run typecheck`, auditoría de features y `git diff --check`;
- comparación de la suite global con el baseline registrado;
- `./startup.sh` y comprobación del servicio y Admin HTTP antes del handoff.

## Preparación de la implementación

Antes de implementar se integrará por fast-forward la rama `codex/role-game-menu`, que parte del commit actual e incorpora el dashboard por secciones y la gestión endurecida de participantes. Después se medirá de nuevo el baseline real de pruebas sobre esa base integrada.

El plan de implementación existente deberá corregirse para reflejar este diseño, especialmente:

- ausencia de backfill y retirada de `character_name`;
- propietarios de cualquier rol confirmado;
- conservación de personajes durante promociones y degradaciones;
- transferencia directa atómica;
- desasignación sólo en transiciones a `left` o `removed`;
- interfaces explícitas entre el repositorio de partidas y el de personajes;
- pruebas que demuestren la semántica concurrente en PostgreSQL o, cuando el harness sea unitario, tanto la forma SQL como el compare-and-set observable.
