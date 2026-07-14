# Estilo de paginación en Telegram

Esta guía describe el patrón esperado para listas paginadas del bot de
Telegram. Léela antes de añadir o cambiar vistas paginadas.

## Patrones existentes

- Las listas de categorías y resultados por tag de Storage son la referencia
  principal para paginación con reply keyboard: lista compacta, enlaces HTML en
  el cuerpo del mensaje y navegación en el teclado persistente.
- Las listas de lectura de catálogo son la referencia para paginación con
  callback buttons: muestran `Pàgina 1/2`, `Página 1/2` o `Page 1/2` al inicio
  y usan botones inline.
- Las listas admin de plantillas de bienvenida deben seguir el estilo de
  Storage porque se navegan desde un teclado privado persistente y las acciones
  de cada item son deep links en el cuerpo del mensaje.

## Texto del mensaje

- Muestra siempre la página actual y el total de páginas cuando una lista tenga
  más de una página.
- Prefiere el footer explícito que ya usa Storage:
  - Catalan: `Mostrant {from}-{to} de {total}. Pàgina {page}/{pages}.`
  - Spanish: `Mostrando {from}-{to} de {total}. Página {page}/{pages}.`
  - English: `Showing {from}-{to} of {total}. Page {page}/{pages}.`
- Coloca el footer de página después de los items visibles para mantener limpio
  el título de la lista.
- Separa título, contenido y footer con una línea en blanco cuando el listado
  tenga varias filas o incluya footer de página.
- Mantén las filas compactas. Usa un deep link por fila para la acción primaria
  de item/detalle, salvo que se pidan atajos explícitos por fila.

## Controles

- Los elementos de una lista cuya función sea abrir su detalle deben ser enlaces
  HTML clicables en el cuerpo del mensaje. Esta es la norma general para los
  flujos lista → detalle.
- Reserva los botones del teclado para acciones, navegación y paginación. No
  repitas como botones los elementos que ya aparecen enlazados en la lista.
- Usa botones de reply keyboard para paginar cuando el flujo ya use teclado
  privado persistente o navegación por texto.
- Usa botones inline callback cuando el flujo ya esté basado en callbacks y los
  botones estén acotados a un mensaje concreto.
- Muestra `Anterior` solo si hay una página previa y `Siguiente`/`Següent` solo
  si hay página siguiente.
- Incluye `Ir a página` / `Anar a pàgina` / `Go to page` en listas largas donde
  saltar de página sea útil.

## Estado y límites

- Guarda la página actual y el total de items en la sesión activa cuando la
  navegación se gestione por texto del reply keyboard.
- Acota las páginas solicitadas a `1..totalPages`.
- Recalcula totales al renderizar, porque el contenido puede cambiar entre
  solicitudes de página.

## Tests

- Cubre primera página, página siguiente, página anterior y límites de página
  para cada flujo paginado.
- Comprueba tanto el footer visible como los botones de navegación disponibles.
