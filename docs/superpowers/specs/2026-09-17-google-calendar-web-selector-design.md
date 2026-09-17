# Especificación de Diseño: Rediseño del Selector Web de Google Calendar

- **Fecha:** 2026-09-17
- **Estado:** Aprobado para implementación
- **Módulos afectados:** `http` (`admin-http-server`), `google-calendar`

---

## 1. Contexto y Objetivos

### 1.1. Problema
En la página de administración `/admin/google-calendar`, la **Sección 2 («Calendario y accesibilidad»)** presenta fricciones críticas de usabilidad para los administradores:
1. **Falta de visibilidad del correo de la cuenta de servicio:** El texto instruye a *«compartir primero el calendario con el correo de la cuenta de servicio»*, pero no muestra dicho correo dentro de la sección ni ofrece una forma rápida de copiarlo. El administrador debe buscarlo en tarjetas superiores o en el servidor.
2. **Estado confuso cuando no hay calendarios compartidos:** Cuando la cuenta de servicio aún no tiene acceso a ningún calendario (0 calendarios), el selector desplegable `<select>` aparece vacío y deshabilitado sin indicar claramente qué paso falta ni cómo resolverlo.
3. **Selección automática vs. manual poco intuitiva:** La entrada manual de ID/enlace está en la misma rejilla que el desplegable sin explicaciones ni jerarquía clara, lo que induce a error sobre dónde obtener el ID del calendario en Google Calendar.
4. **Falta de actualización inmediata:** No existe un botón directo en la sección para volver a consultar a Google si el calendario ya fue compartido, obligando a recargar la página completa o a usar el botón de prueba de la sección 1.

### 1.2. Objetivos
1. **Asistente de conexión guiado:** Presentar un bloque visual destacado con el correo de la cuenta de servicio, botón interactivo de copiado en 1 clic y los 3 pasos exactos para compartir el calendario en Google Calendar.
2. **Tarjetas interactivas de selección:** Mostrar los calendarios detectados mediante tarjetas visuales (radio cards) con nombre, rol (`propietario`/`editor`), ID y estado de selección.
3. **Estado vacío asistido:** Si hay 0 calendarios detectados, mostrar un panel explicativo amigable con botón para refrescar la detección.
4. **Entrada manual plegable:** Reubicar el campo de ID manual en un acordeón nativo `<details>` accesible con instrucciones claras de dónde encontrar el ID en Google Calendar.
5. **Selector de accesibilidad claro:** Explicación visual de Privado vs. Público antes de guardar.

---

## 2. Diseño de Interfaz y Experiencia de Usuario (UI/UX)

### 2.1. Bloque de Guía Rápida (`.calendar-guide-callout`)
Situado al inicio de la Sección 2:
- Título: **Paso 1: Comparte tu calendario con el bot**
- Caja con el correo de la cuenta de servicio (`clientEmail`) y botón interactivo `Copiar correo` (`data-copy-target` o script de clipboard) con confirmación visual (*«✓ ¡Copiado!»*).
- 3 pasos concisos:
  1. Abre Google Calendar con la cuenta que administra el calendario del club.
  2. En el menú del calendario (tres puntos ⋮), entra en **Configurar y compartir** → **Compartir con determinadas personas o grupos**.
  3. Añade el correo copiado con el permiso: **«Hacer cambios y gestionar el uso compartido»** (o al menos *«Hacer cambios en eventos»*).
- Botón secundario en línea: **«Comprobar calendarios compartidos»** que dispara la acción `test-connection` para actualizar la lista en caliente.

### 2.2. Selector Visual de Calendarios
- **Si `state.calendars.length > 0`:**
  - Contenedor en cuadrícula `.calendar-cards-grid`.
  - Cada calendario se representa como una tarjeta `<label class="calendar-card">`:
    - Radio button nativo `input[type="radio"][name="calendarId"]` con `value="{id}"`.
    - Nombre del calendario (`summary`) en negrita.
    - Etiqueta de rol (`accessRole`: `owner` -> *Propietario*, `writer` -> *Editor*).
    - ID en formato monoespaciado (`calendar.id`).
    - Si coincide con el calendario actualmente configurado, incluye badge visual *«Activo»*.
- **Si `state.calendars.length === 0`:**
  - Contenedor `.calendar-empty-state`:
    - Mensaje claro: *«Aún no se ha detectado ningún calendario compartido con esta cuenta.»*
    - Recordatorio para completar el Paso 1 y pulsar *«Comprobar calendarios compartidos»*.

### 2.3. Entrada Manual Plegable (`<details class="calendar-manual-details">`)
- Elemento nativo `<details>` con `<summary>¿No aparece en la lista o prefieres introducirlo manualmente?</summary>`.
- Campo de texto `manualCalendar` con placeholder `club@group.calendar.google.com o enlace con cid`.
- Texto de ayuda indicando que en Google Calendar se encuentra en: *Configuración del calendario → Integrar el calendario → ID de calendario*.

### 2.4. Accesibilidad y Guardado
- Selector de visibilidad con opciones:
  - 🔒 **Privado:** Solo los socios o grupos autorizados en Google pueden ver las actividades.
  - 🌐 **Público:** Cualquier persona con el enlace puede consultar los eventos del calendario.
- Botón primario: **«Guardar calendario y accesibilidad»**.
- Si ya hay un calendario activo, muestra el enlace para abrirlo directamente en Google Calendar.

---

## 3. Arquitectura Técnica y Estilos CSS

### 3.1. Estilos CSS (integrados en `admin-http-server.ts`)
Siguiendo las pautas de marca de `docs/brand-guidelines.md`:
- Variables: `--cawa-brand`, `--cawa-surface`, `--cawa-surface-alt`, `--cawa-line`, `--cawa-muted`.
- Tarjetas con bordes redondeados (`border-radius: 8px`), hover sutil y borde verde de marca cuando está seleccionada (`:has(:checked)` o clase `.selected`).
- Responsive: rejilla auto-fit para pantallas estrechas y móviles.

### 3.2. Script JavaScript Ligero
- Copiado al portapapeles sin dependencias externas:
  ```javascript
  navigator.clipboard.writeText(...)
  ```
- Si el usuario introduce texto en `manualCalendar`, se desmarcan visualmente los radios para evitar confusiones.

### 3.3. Compatibilidad con el Backend
- El endpoint POST `/admin/google-calendar` con `action="configure-calendar"` ya procesa:
  ```typescript
  const calendarIdOrUrl = typeof body.manualCalendar === 'string' && body.manualCalendar.trim()
    ? body.manualCalendar.trim()
    : typeof body.calendarId === 'string'
      ? body.calendarId.trim()
      : '';
  ```
  Esto garantiza total compatibilidad tanto con tarjetas seleccionadas (`body.calendarId`) como con el acordeón manual (`body.manualCalendar`).

---

## 4. Pruebas y Validación

1. **Tests unitarios (`src/http/admin-http-server.test.ts`):**
   - Verificar que la página de `/admin/google-calendar` renderiza la guía con el correo de la cuenta de servicio.
   - Verificar que cuando hay calendarios disponibles, se renderizan las tarjetas de selección.
   - Verificar que cuando no hay calendarios disponibles, se renderiza el estado vacío asistido y el botón de comprobación.
   - Verificar que el acordeón de entrada manual está presente en el HTML.
2. **TypeScript & Tests Globales:**
   - `npm run typecheck`
   - `node --import tsx --test src/google-calendar/google-calendar-settings.test.ts src/google-calendar/google-calendar-sync.test.ts src/google-calendar/google-calendar-admin-service.test.ts`
3. **Despliegue Local:**
   - `./startup.sh` para verificar el reinicio del servicio en caliente y la carga en el navegador.
