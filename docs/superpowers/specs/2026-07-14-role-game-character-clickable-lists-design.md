# Diseño: listas de personajes con enlaces de texto

## Objetivo

Las vistas `Mis personajes`, `Personajes de la campaña` y `Personajes sin asignar` deben mostrar cada personaje como un enlace HTML de texto que abra su detalle. Los nombres de personajes dejan de aparecer como botones del teclado de respuesta.

La norma UX general queda formulada así:

- Los elementos seleccionables que llevan de una lista a un detalle se representan mediante enlaces clicables en el cuerpo del mensaje.
- Los teclados de respuesta se reservan para acciones, navegación y paginación.

Esta tarea aplica la norma a los tres listados principales de personajes y la incorpora a la guía común. No migra otros módulos históricos del bot.

## Presentación

Cada fila de personaje usará el deep link autorizado ya existente:

```html
• <a href="https://t.me/<bot>?start=role_character_<id>"><b>Nombre</b></a>
```

El nombre se escapará como HTML y la URL se construirá con `buildTelegramStartUrl`. Si el personaje está libre, `· Sin asignar` se mostrará después del enlace y no formará parte de él.

El mensaje conservará título, contenido y footer localizado. El teclado contendrá únicamente los controles de página válidos, `Volver a personajes`, `Inicio` y `Ayuda`.

## Flujo y seguridad

El enlace `role_character_<id>` seguirá pasando por el handler existente, que recarga personaje, partida y membresía antes de comprobar visibilidad. Un personaje privado ajeno o inexistente responderá con el mismo mensaje no revelador actual.

Las vistas de lista ya no seleccionarán personajes comparando el texto recibido ni guardarán un mapa `characterButtons`. La sesión conservará sólo el tipo de vista, página y total necesarios para navegar. Los asistentes donde elegir un miembro representa una acción seguirán usando botones.

## Cambios previstos

- `src/telegram/role-game-character-flow.ts`: formatear filas enlazadas y retirar la selección por texto en los tres listados.
- `src/telegram/role-game-character-keyboards.ts`: retirar botones de personajes de ese teclado y mantener sólo navegación/paginación.
- `src/telegram/role-game-character-flow.test.ts`: cubrir enlaces, escape HTML, ausencia de botones de personaje y deep links privados seguros.
- `docs/telegram-pagination-style.md`: convertir la regla lista-detalle en norma obligatoria.
- `docs/feature-status.md`: registrar el comportamiento visible.

## Verificación

- Pruebas específicas del flujo de personajes y del flujo general de Rol.
- Typecheck, auditoría del inventario y `git diff --check`.
- Suite objetivo de Rol y Storage.
- `./startup.sh` y comprobación del servicio desplegado.

## Fuera de alcance

- Migrar en esta tarea otros listados históricos del bot.
- Sustituir botones que representan acciones o elecciones de un asistente.
- Cambiar permisos, privacidad, paginación o contratos de persistencia de personajes.
