# Gestión de impresora desde Telegram

## Objetivo

Añadir una feature privada `Imprimir` para que socios aprobados puedan imprimir
documentos PDF u Office desde el bot cuando un admin haya activado la función.
La feature debe servir para casos reales del club, como fichas de rol de pocas
páginas con varias copias, sin abrir una vía fácil de abuso de papel, tóner o
recursos del PC.

La impresora física del club no se usará en las validaciones automáticas ni en
las pruebas del agente. La validación de desarrollo debe apoyarse en tests,
dobles de impresión y, si hace falta, una cola virtual tipo CUPS-PDF o una cola
CUPS temporal controlada. La prueba real contra la impresora física queda para
cuando un responsable esté en persona en el club.

## Alcance de la primera versión

- Entrada desde el botón privado `Imprimir`, visible para socios aprobados y
  admins cuando la feature esté activada o en modo prueba.
- Entrada desde Storage: los detalles de archivos imprimibles mostrarán una
  acción `Imprimir` cuando la feature esté activada y el usuario tenga permiso
  de lectura sobre la entrada.
- Gestión admin desde `Admin` -> `Impresora`.
- Adjuntos Telegram PDF y documentos Office convertibles a PDF mediante
  LibreOffice headless.
- Archivos imprimibles guardados en Storage, reutilizando sus permisos actuales.
- Selección de páginas antes de imprimir: todas, rango o lista.
- Selección de copias.
- Selección de una cara o doble cara automática.
- Confirmación extra cuando se seleccionen más de 10 páginas distintas.
- Confirmación extra cuando se pidan más de 10 copias.
- Confirmación final antes de enviar el trabajo a CUPS.
- Historial visible para admins.
- Borrado de archivos temporales al completar, cancelar o fallar.
- Rechazo explícito de archivos que superen el límite de descarga del Bot API de
  Telegram en la nube (20 MB), antes de llamar a `getFile` cuando el tamaño esté
  informado y no exista soporte local de descargas grandes.
- Integración opcional con un servidor Telegram Bot API local sólo para
  impresión, manteniendo el resto del bot en la ruta cloud actual. El despliegue
  instala la unidad systemd hermana `gameclubtelegrambot-local-bot-api.service`
  y `startup.sh` la sincroniza con el servicio principal según
  `telegram.localBotApi.enabled`; si falta el binario, el instalador puede
  compilar `telegram-bot-api` desde la fuente oficial de TDLib.

Quedan fuera de la primera versión:

- Enlaces externos o descargas por URL.
- Impresión desde grupos o topics.
- Modo manual de doble cara girando papel.
- Cancelación de trabajos ya enviados a CUPS.
- Límites configurables por usuario desde UI avanzada.
- Vista web admin completa; la primera versión puede resolver el historial desde
  Telegram y dejar el panel web para una iteración posterior salvo que el coste
  de integrarlo sea muy bajo.

## Estado de activación y permisos

La impresión estará apagada por defecto. Cualquier usuario con rol admin puede
abrir `Admin` -> `Impresora` y elegir `Activar`, `Desactivar` o `Modo prueba` en
caliente. El estado se persistirá en la base de datos para sobrevivir reinicios.

Cuando está desactivada:

- No aparece el botón `Imprimir` en el menú privado raíz.
- No aparece la acción `Imprimir` en detalles de Storage.
- No se pueden iniciar nuevas sesiones de impresión.
- Las sesiones ya iniciadas pueden terminar; la desactivación no invalida un
  flujo que ya está preparando un trabajo.

Cuando está en modo prueba:

- El botón `Imprimir` aparece igual que en modo activo.
- Socios aprobados y admins pueden recorrer el flujo completo.
- El bot descarga, convierte, inspecciona, pide páginas/copias/caras y registra
  historial.
- Al confirmar, el bot no invoca `lp` ni envía nada a CUPS; marca el historial
  con ID `test-mode`.
- Sirve para validar programación y UX sin gastar papel ni tinta.

Cuando está activada:

- Socios aprobados y admins pueden iniciar impresión desde privado.
- Usuarios pendientes, bloqueados o no aprobados no pueden imprimir.
- Storage sigue siendo la autoridad de permisos para archivos guardados: si el
  usuario puede leer la entrada de Storage, puede iniciar el flujo de impresión
  para ese archivo.

## Flujo de impresión desde adjunto

1. El usuario pulsa `Imprimir`.
2. El bot crea una sesión privada `print-job` y pide un adjunto PDF u Office.
3. El usuario envía un documento.
4. El bot comprueba el tamaño declarado por Telegram. Si supera 20 MB y no está
   activo el soporte local de descargas grandes, lo rechaza con explicación.
5. El bot descarga el fichero con la capacidad Telegram `downloadFile`.
6. El bot valida extensión/MIME y tipo detectado con `file`.
7. Si es PDF, lo conserva como fuente normalizada.
8. Si es Office, lo convierte a PDF con `soffice --headless --convert-to pdf`.
9. El bot inspecciona el PDF resultante con `pdfinfo` y obtiene el número de
   páginas.
10. El bot pregunta qué páginas imprimir:
   - `Todas`.
   - Rango como `1-4`.
   - Lista como `1,3,5-7`.
11. El bot valida que las páginas existan y elimina duplicados.
12. El bot pregunta cuántas copias imprimir.
13. El bot pregunta `Una cara` o `Doble cara`.
14. Si la selección contiene más de 10 páginas distintas, pide confirmación
    extra.
15. Si el número de copias supera 10, pide confirmación extra.
16. El bot muestra resumen final:
    - Archivo.
    - Origen: adjunto Telegram.
    - Páginas distintas.
    - Copias.
    - Total físico estimado.
    - Modo: una cara o doble cara.
    - Impresora/cola CUPS.
17. Al confirmar, el bot envía el trabajo con `lp`.
18. El bot registra el resultado en el historial.
19. El bot borra temporales y completa la sesión.

## Flujo de impresión desde Storage

Storage ofrece la acción `Imprimir` en el detalle de entradas imprimibles cuando:

- La feature de impresión está activada.
- El usuario está aprobado.
- La entrada contiene al menos un mensaje con adjunto imprimible.
- El usuario tiene permiso de lectura sobre la categoría/entrada.

Si una entrada tiene varios adjuntos imprimibles, la v1 toma el primer adjunto
imprimible guardado en el detalle de Storage. Una iteración posterior puede
añadir selección explícita entre adjuntos. Para descargar el contenido se usa el
`telegramFileId` guardado en `storage_entry_messages` cuando está disponible. Si
falta el `telegramFileId`, el bot no muestra la acción de impresión para ese
mensaje.

Después de seleccionar el archivo, el flujo es igual al de adjunto directo:
normalización a PDF, páginas, copias, una/doble cara, confirmaciones y resumen
final.

La descarga desde Storage también pasa por `telegramFileId`. Si no hay Bot API
local activado, conserva el mismo límite cloud de 20 MB. Si `telegram.localBotApi`
está activo, el flujo de impresión opta explícitamente a la ruta local mediante
`allowLocalBotApi: true`, por lo que puede preparar archivos mayores sin cambiar
el comportamiento normal de Storage.

## Doble cara

El bot ofrecerá siempre la elección `Una cara` / `Doble cara`, pero solo enviará
doble cara automática cuando la cola CUPS indique soporte. En la cola actual
`HP-LaserJet-P2015-Series`, `lpoptions` expone `Duplex/2-Sided Printing`, así
que la implementación debe detectar esa capacidad y mapear:

- `Una cara` -> `lp -o sides=one-sided`.
- `Doble cara` -> `lp -o sides=two-sided-long-edge`.

Si CUPS no expone dúplex automático, el bot debe avisar y permitir continuar a
una cara. No se implementa doble cara manual.

## Control de abuso

La feature no bloquea por número total físico de hojas porque el club imprime a
veces pocas páginas con muchas copias para partidas de rol. En su lugar:

- Si hay más de 10 páginas distintas seleccionadas, el bot pide confirmación
  extra.
- Si se piden más de 10 copias, el bot pide confirmación extra.
- Siempre hay confirmación final antes de imprimir.
- El historial admin permite revisar trabajos, fallos y consumos estimados.
- No se aceptan enlaces externos en la primera versión.
- Los archivos temporales no se conservan.

## Historial y auditoría

Cada intento de impresión debe quedar registrado en una tabla persistente, con
campos suficientes para auditoría y diagnóstico:

- ID del trabajo interno.
- Telegram user ID y nombre visible del solicitante.
- Origen: `telegram_attachment` o `storage_entry`.
- ID de entrada/mensaje Storage cuando aplique.
- Nombre original del archivo.
- MIME/tipo detectado.
- Número de páginas del documento normalizado.
- Páginas seleccionadas en forma compacta.
- Conteo de páginas distintas.
- Copias.
- Total físico estimado.
- Modo de caras: `one-sided` o `two-sided-long-edge`.
- Cola CUPS usada.
- Estado: `prepared`, `submitted`, `failed`, `cancelled`.
- ID de trabajo CUPS si `lp` lo devuelve.
- Mensaje de error seguro si falla.
- Fechas de creación, envío y finalización.

El historial visible para admins debe listar los trabajos recientes con paginación
simple y detalle compacto. No debe mostrar rutas locales temporales ni contenido
de documentos.

En modo prueba, el historial usa el mismo registro persistente, con `cupsJobId =
test-mode`, para dejar constancia de la simulación sin afirmar que CUPS haya
recibido un trabajo real.

## Componentes técnicos

### Servicio de impresión

Nuevo módulo de dominio, por ejemplo `src/printing/`, responsable de:

- Leer/escribir configuración de activación.
- Inspeccionar capacidades de CUPS.
- Validar y normalizar documentos a PDF.
- Parsear rangos de páginas.
- Pasar rangos de páginas a CUPS con `lp -o page-ranges=...`.
- Invocar `lp`.
- Registrar historial.

La invocación de procesos debe quedar detrás de una interfaz inyectable para que
los tests no llamen a CUPS, LibreOffice ni a la impresora física.

### Flujo Telegram

Nuevo flujo `src/telegram/print-flow.ts` responsable de la conversación privada:

- Entrada desde botón `Imprimir`.
- Entrada desde callback de Storage.
- Sesión `print-job`.
- Mensajes de progreso editables para descarga, conversión, inspección y envío.
- Teclados de respuesta para opciones de páginas, copias, caras y confirmación.

Los textos visibles deben estar centralizados en i18n, al menos para español,
catalán e inglés, siguiendo los patrones actuales del repo.

### Menú admin

El submenú `Admin` añadirá una acción `Impresora`. Desde ahí:

- Mostrar estado actual: activada/desactivada, cola CUPS, estado de impresora,
  soporte dúplex y últimos trabajos.
- Activar/desactivar.
- Refrescar estado.
- Abrir historial paginado.

Las acciones admin quedan fuera de LLM y fuera de grupos.

### Storage

El detalle de Storage añadirá una acción `Imprimir` para entradas imprimibles.
La acción no debe saltarse permisos: debe reutilizar las comprobaciones de
lectura existentes antes de iniciar el flujo.

### Configuración operativa

La v1 no añade campos obligatorios al JSON runtime. La configuración operativa
vive en `app_metadata` bajo la clave `printing.settings` y contiene el estado
admin (`disabled`, `test` o `enabled`) y la cola CUPS persistida. Si todavía no
existe configuración, el bot considera la feature desactivada y usa como
fallback la cola actual `HP-LaserJet-P2015-Series`. Los valores antiguos
`enabled: true/false` se interpretan como `enabled` o `disabled`.

## Pruebas y validación

No se harán pruebas reales contra la impresora física desde el agente. La
validación aceptable será:

- Tests unitarios para parseo de páginas.
- Tests del servicio con runner de procesos falso para `pdfinfo`, `soffice`,
  `pdfseparate`/herramienta elegida y `lp`.
- Tests de flujo Telegram para:
  - Botón visible solo cuando la feature está activada.
  - Bloqueo de inicio cuando está desactivada.
  - Sesiones ya iniciadas siguen si se desactiva después.
  - Adjuntos no soportados se rechazan.
  - Confirmación extra por más de 10 páginas distintas.
  - Confirmación extra por más de 10 copias.
  - Selección de una/doble cara.
  - Inicio desde Storage respetando permisos.
  - Registro de historial.
- Tests admin para activar/desactivar y listar historial.
- `npm run typecheck`.
- `npm run db:check` si hay migración.
- `./scripts/feature-status-audit.sh`.
- `./startup.sh`.

Si se crea una impresora virtual durante desarrollo, debe usarse solo para
validar integración CUPS de forma no destructiva y quedar documentada. La prueba
real de papel/tóner la hará el usuario presencialmente en el club.

## Documentación a mantener

Si se implementa o cambia esta feature, actualizar:

- `docs/feature-status.md`, añadiendo la impresión al inventario operativo.
- `docs/runtime-configuration.md`, documentando variables de impresión.
- Esta spec si cambia una decisión de producto importante.
