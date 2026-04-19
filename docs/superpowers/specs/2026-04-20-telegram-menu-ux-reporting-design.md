# Telegram Menu UX Reporting Design

## Goal

Construir un visor usable de la telemetria UX del menu principal del bot que pueda consultarse de dos formas sobre el mismo nucleo de datos:

- un CLI de texto bonito para uso rapido y copy-paste
- una TUI interactiva para exploracion mas comoda desde terminal

La UX objetivo es:

- obtener en segundos un resumen claro del uso del menu principal
- ver que acciones se usan mas y como cambia el uso por rol
- reutilizar la misma logica de lectura y agregacion en texto y TUI

## Scope

La v1 cubre solo:

- lectura de eventos `telegram.menu.shown` y `telegram.menu.action_selected` desde `audit_log`
- agregacion de un snapshot de telemetria UX del menu principal
- un script CLI de texto no interactivo
- una consola TUI interactiva simple
- scripts npm para lanzar ambas interfaces
- tests del agregador, formatter de texto, parseo de args y layout TUI basico

La v1 no cubre:

- filtros complejos por fechas arbitrarias, idioma o menu concreto
- exportacion CSV o JSON
- drilldown por usuario concreto
- timeline detallada de actividad reciente
- telemetria de inline keyboards o flujos internos fuera del menu principal

## Current Project Context

El repositorio ya ofrece dos patrones claros que conviene seguir:

- scripts CLI sencillos en `src/scripts/`
- consolas TUI con `blessed` en `src/tui/`, como la backup console

La telemetria ya se esta guardando en `audit_log` con:

- `telegram.menu.shown`
- `telegram.menu.action_selected`

Esos eventos incluyen en `details` los campos suficientes para una v1 del visor:

- `actorRole`
- `language`
- `menuId`
- `actionId`
- `telemetryActionKey`
- `visibleActionIds`
- `visibleLabels`

Eso significa que la v1 no necesita nuevas migraciones ni nuevos eventos. Solo hace falta una capa de lectura y presentacion.

## Approaches Considered

### 1. Dos implementaciones separadas, una para CLI y otra para TUI

Ventaja: libertad total en cada interfaz.

Inconveniente: duplica consultas, agregaciones, formato de conceptos y tests.

### 2. Nucleo compartido de reporting con dos frontends

Ventaja: una sola fuente de verdad para resumenes y rankings, menos duplicacion y menor riesgo de inconsistencias.

Inconveniente: obliga a definir un snapshot intermedio antes de pintar la salida.

### 3. Solo TUI y dejar el CLI para mas tarde

Ventaja: interfaz mas vistosa desde el inicio.

Inconveniente: peor para uso rapido, scripting y pegado en mensajes.

La opcion recomendada es la 2.

## Recommended Architecture

### 1. Shared Reporting Core

La pieza central debe ser un lector/agregador comun en `src/operations/` que devuelva un snapshot de telemetria UX listo para presentar.

Nombre orientativo:

- `src/operations/telegram-menu-ux-report.ts`

Responsabilidades:

- leer eventos relevantes de `audit_log`
- filtrar por ventana temporal simple de v1
- agrupar y calcular metricas derivadas
- devolver un snapshot serializable y agnostico de la interfaz

No debe formatear tablas ni decidir colores. Solo datos agregados.

### 2. Snapshot Shape

El snapshot v1 debe incluir como minimo:

- `windowDays`
- `generatedAt`
- `summary`
- `topActions`
- `roleBreakdown`

`summary`:

- `menuShownCount`
- `actionSelectedCount`
- `interactionRate`
- `distinctMenus`
- `distinctActions`

`topActions`:

- `telemetryActionKey`
- `actionId`
- `labelSample`
- `selectionCount`
- `share`

`roleBreakdown`:

- `actorRole`
- `menuShownCount`
- `actionSelectedCount`
- `interactionRate`
- `topActionKey`

No hace falta incluir datos por idioma ni menus sin interaccion en esta v1 porque el usuario no los ha pedido como vista obligatoria.

### 3. Time Window Contract

La v1 debe soportar solo una ventana simple basada en dias recientes.

Contrato recomendado:

- por defecto: ultimos `7` dias
- opcional: `--days <n>`

No se anaden aun `--from` ni `--to`. Eso simplifica parseo, tests y copy del CLI.

### 4. Text CLI

Script recomendado:

- `src/scripts/telegram-menu-ux-report.ts`

Comando npm recomendado:

- `npm run telegram:ux`

La salida debe ser bonita pero estable, basada en bloques de texto y tablas ASCII simples. Debe poder copiarse tal cual a un chat o incidencia.

Secciones:

- cabecera con rango temporal y timestamp
- bloque `Resumen`
- bloque `Top acciones`
- bloque `Por rol`

El formatter debe vivir separado del lector para que pueda testearse sin base de datos ni terminal real.

### 5. TUI Console

Script recomendado:

- `src/scripts/telegram-menu-ux-console.ts`

Modulo TUI recomendado:

- `src/tui/telegram-menu-ux-console-app.ts`

Comando npm recomendado:

- `npm run telegram:ux:tui`

La TUI v1 debe ser pequena y predecible:

- cabecera con rango temporal y refresco manual disponible
- pestañas o selector simple entre `Resumen`, `Top acciones` y `Por rol`
- `q` para salir
- `r` para refrescar

No hace falta navegacion profunda, modales ni filtros interactivos en esta primera version.

### 6. Database Access

La consulta puede apoyarse en `pg` o en la capa de base de datos ya usada por el proyecto, pero la recomendacion es mantenerla simple y explicita para reporting.

La v1 debe leer solo `audit_log` con filtro por:

- `action_key in ('telegram.menu.shown', 'telegram.menu.action_selected')`
- `created_at >= now() - interval '<n> days'`

La agregacion principal debe hacerse en TypeScript, no repartir demasiada logica entre varias consultas SQL complejas. Para esta escala y esta v1 es mas facil de mantener.

## Data Flow

### Flow 1: Text CLI

1. El operador ejecuta `npm run telegram:ux`.
2. El script parsea `--days` o usa `7` por defecto.
3. El agregador lee eventos de `audit_log` dentro de esa ventana.
4. Se construye el snapshot comun.
5. El formatter de texto renderiza `Resumen`, `Top acciones` y `Por rol`.
6. El script escribe el resultado a stdout.

### Flow 2: TUI

1. El operador ejecuta `npm run telegram:ux:tui`.
2. La TUI carga el snapshot inicial para la ventana por defecto.
3. La cabecera muestra rango y totales.
4. El panel activo pinta una de las tres vistas.
5. Si el operador pulsa `r`, la TUI vuelve a cargar el snapshot y repinta.
6. Si pulsa `q`, la aplicacion sale limpiamente.

## Error Handling

- Si la configuracion runtime no es valida o no hay acceso a la base de datos, ambos launchers deben fallar con un mensaje claro para operador.
- Si no hay eventos UX en la ventana seleccionada, el CLI y la TUI deben mostrar un estado vacio legible, no una excepcion.
- Si algun evento tiene `details` incompleto o parcialmente corrupto, el agregador debe ignorar solo ese evento o degradar los campos faltantes, sin abortar todo el reporte.
- Si la TUI no dispone de terminal interactiva, debe fallar con un mensaje claro, siguiendo el patron ya usado por la backup console.

## Testing

La v1 debe cubrir:

- agregacion correcta de `menu.shown` y `menu.action_selected`
- calculo de totales, porcentajes y top acciones
- desglose por rol
- formatter de texto estable
- parseo de `--days`
- render TUI basico y refresco simple

No hace falta test de integracion end-to-end con terminal real. La logica importante debe quedar aislada en funciones testeables.

## Acceptance Criteria

- Existe un comando de texto para ver la telemetria UX del menu principal.
- Existe una TUI para ver la misma informacion con navegacion simple.
- Ambas interfaces usan el mismo snapshot agregado.
- La v1 muestra `Resumen`, `Top acciones` y `Por rol`.
- El rango temporal por defecto es 7 dias y puede cambiarse con `--days`.
- El sistema se comporta bien cuando no hay datos.
- La suite de tests cubre agregacion, formato y TUI basica.
