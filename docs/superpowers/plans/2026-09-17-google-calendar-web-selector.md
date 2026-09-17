# Plan de Implementación: Rediseño del Selector Web de Google Calendar

- **Fecha:** 2026-09-17
- **Especificación:** [`docs/superpowers/specs/2026-09-17-google-calendar-web-selector-design.md`](file:///home/cawa/telegrambot/gameclubtelegrambot/docs/superpowers/specs/2026-09-17-google-calendar-web-selector-design.md)
- **Módulos afectados:** `http` (`admin-http-server`), `google-calendar`

---

## Tareas

### Tarea 1: Pruebas Automatizadas en `src/http/admin-http-server.test.ts`
- Añadir aserciones o subtests en `src/http/admin-http-server.test.ts` que validen:
  1. Renderizado de la guía paso a paso con el correo de la cuenta de servicio y botón de copiar.
  2. Renderizado del estado vacío `.calendar-empty-state` cuando `calendars` está vacío.
  3. Renderizado de tarjetas interactivas de calendario (`.calendar-card`) cuando hay calendarios disponibles.
  4. Presencia del acordeón `<details class="calendar-manual-details">` con el campo manual y texto de ayuda.
  5. Envío del formulario de guardado y botón de comprobación.

### Tarea 2: Implementación HTML y Estilos CSS en `src/http/admin-http-server.ts`
- Definir estilos CSS adaptados a la guía de diseño (`docs/brand-guidelines.md`):
  - `.calendar-guide-callout`: fondo suave, bordes claros, pasos ordenados, caja de correo monoespaciado con botón.
  - `.calendar-cards-grid`: grid responsive (`auto-fill, minmax(240px, 1fr)`).
  - `.calendar-card`: tarjeta interactiva con `input[type="radio"]`, título, badge de rol y ID en `code`.
  - `.calendar-empty-state`: banner centrado informativo con icono/texto claro y botón de refresco.
  - `.calendar-manual-details`: acordeón nativo `<details>` con resumen claro y campo de entrada.
  - `.calendar-visibility-grid`: selector de visibilidad público/privado con radio cards o estilo coherente.
- En la función que genera la página `/admin/google-calendar`, reemplazar la antigua Sección 2 con la nueva estructura.

### Tarea 3: Script Interactivo Ligero en `src/http/admin-http-server.ts`
- Añadir un `<script>` inline ligero que:
  1. Maneje el botón `Copiar correo` con `navigator.clipboard.writeText(...)` y feedback visual temporal («✓ ¡Copiado!»).
  2. Al escribir en el campo de ID manual, desmarque los radio buttons de tarjetas para evitar ambigüedades.
  3. Al seleccionar una tarjeta, limpie el campo manual.

### Tarea 4: Verificación, Documentación y Arranque
- Ejecutar `node --import tsx --test src/http/admin-http-server.test.ts`.
- Ejecutar `npm run typecheck`.
- Ejecutar tests de Google Calendar (`src/google-calendar/*.test.ts`).
- Actualizar `docs/feature-status.md` y ejecutar `./scripts/feature-status-audit.sh`.
- Ejecutar `./startup.sh` y validar con `./scripts/service-journal.sh`.
- Realizar commit y push.
