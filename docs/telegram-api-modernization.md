# Modernización de Telegram — ticket #32

Seguimiento operativo del 9 de octubre de 2026. Referencia:
[issue #32](https://github.com/RubenGM/gameclubtelegrambot/issues/32).

## Alcance entregado

- grammY 1.46.0 y runner 2.0.3, con tipos para Bot API 10.3.
- Node 24 LTS en CI y scripts; runtime dedicado del PC en
  `/opt/gameclubtelegrambot-node/bin/node` (24.21.0).
- Polling supervisado, concurrencia limitada y orden de sesiones por chat/usuario.
- Mensajes rich en fichas privadas de catálogo y detalles de Agenda,
  con límites oficiales y fallback a mensajes convencionales.
- Síntesis privada con deltas reales de Codex app-server, borradores agrupados,
  cancelación y resultado completo duradero. Las decisiones permanecen como
  JSON validado; los permisos se resuelven localmente.

La API pública de Telegram es el endpoint efectivo de mensajes. El Bot API
local opcional no está activado en este despliegue y sólo interviene en
rutas explícitas de descarga cuando se habilita.

## Evidencia real obtenida

Prueba privada autorizada al administrador principal (`13005632`):

- `sendRichMessage` aceptó encabezado y tabla; mensaje `33932`.
- Telegram aceptó `sendMessageDraft` y `sendRichMessageDraft`.
- Codex produjo 1008 deltas de respuesta real, agrupados en 20 borradores rich.
- Primer delta a los 2746 ms; primer borrador entregado a los 2835 ms;
  final del proveedor a los 13796 ms. Hubo contenido útil antes de terminar.
- El resultado completo de 4340 caracteres se envió como mensaje rich duradero.
- Una generación real abortada después de los primeros deltas rechazó con
  `cancelled`: 34 deltas, señal a los 3510 ms y cierre a los 3545 ms.

Las cifras describen esta prueba, no una garantía de latencia.

## Validación y seguimiento

La actualización de dependencias y CI exige suite ampliada por el selector
`npm test`. La integración PostgreSQL se ejecuta contra una base temporal
independiente. La validación ampliada pasó 1319 tests unitarios y 8 de integración, typecheck,
build, lint, documentación e inventario. `startup.sh` desplegó la actualización
y se verificaron el proceso systemd real en Node 24.21.0, la autenticación
Telegram y el polling. La web pública respondió 200 y el admin redirigió a login
(303).

La cancelación por evento Stop nativo y la concurrencia con dos usuarios tienen
cobertura automatizada. El 9 de octubre el usuario respondió «Validado» a la
prueba de pulsar Stop después de aparecer contenido en el borrador de `/ask`:
la pulsación efectiva queda confirmada desde el cliente real. El usuario no
dispone de una segunda cuenta; esa prueba presencial de concurrencia no se ha
realizado y se distingue de las pruebas técnicas. La prueba con el UID real del servicio (`gameclubbot`, 997) ejecutó Codex
bajo el operador (`cawa`, 1000) mediante sudo y supervisor instalado. Se
recibieron 32 deltas y se comprobó que toda la cadena de procesos desapareció
tras abortar. Una fixture resistente a TERM también quedó eliminada en 341 ms;
la regla sudoers rechazó otro binario y el bypass `--local-bin`.

El usuario ha pedido una muestra privada del calendario del club en formato
rich para decidir su uso en publicaciones. La primera muestra (mensaje `33934`)
contiene 10 actividades en tablas, aceptadas como rich por Telegram. La captura
de móvil mostró desbordamiento horizontal. Se probaron una alternativa vertical
(`33935`) y una tabla compacta de dos columnas con dos filas por actividad
(`33936`). El usuario aceptó expresamente esta última y pidió aplicarla al
calendario público. La integración pública se desplegó y el calendario actual de `events` en el
chat `-1003515960088`, topic `3`, mensaje `4000` se convirtió mediante edición
a rich con 10 actividades. Telegram devolvió `rich_message=true`; se conservó
la referencia del snapshot y no hubo warnings. No hay destinos `public-events`
suscritos actualmente.

Por petición posterior del usuario, las listas privadas `Actividades` y
`Ver actividades` comparten este formato y conservan equipamiento, impacto del
local, plazas, enlaces y teclado. Mantienen el listado completo sin horizonte
ni etiqueta de 30 días. La revisión Sol y la validación final del área Agenda
pasaron 156 pruebas, typecheck, lint, documentación e inventario.

Referencias técnicas: [Telegram Bot API](https://core.telegram.org/bots/api),
[guía LLM](llm-natural-language.md), [progreso](telegram-editable-progress.md),
[arquitectura](architecture.md) e [inventario](feature-status.md).

## Verificación de `/ask` después del despliegue

El primer ensayo desde Telegram detectó permisos `0600` en el schema desplegado:
Codex, ejecutado como `cawa`, no podía leerlo. El instalador normaliza sólo los
archivos estáticos `src/**/*.schema.json` a `0644`; otros JSON y destinos de
symlinks conservan sus permisos. La prueba real como `gameclubbot` completó la
interpretación en 6603 ms y la síntesis con 10 deltas en 2928 ms usando
`gpt-6-luna`/`low`. El usuario confirmó que `/ask` ya responde y que el botón
Stop aparece durante el borrador; su pulsación efectiva quedó confirmada en la
validación posterior descrita arriba. El seguimiento registra ahora inicio,
origen de cancelación y liberación por borrador, sin texto ni tokens, y las
paradas repetidas no vuelven a abortar.

## Cierre técnico del 9 de octubre

La comprobación adicional de concurrencia ejecutó los módulos instalados del
scheduler, el registro de trabajos y el decoder de Stop como `gameclubbot`,
con las variables efectivas del wrapper Codex y el supervisor bajo `cawa`.
Usó dos sesiones lógicas: A generaba mediante Codex real; B completó una
consulta de sólo lectura `getMe` contra la API pública de Telegram antes de
terminar A. Una segunda acción de A permaneció en cola hasta el cierre.

El ensayo final produjo 24 deltas. La secuencia fue `A:start`, `B:start`,
`B:end`, `stop:start`, `stop:end`, `A:end`, `A-next:start`, `A-next:end`;
Stop liberó el registro en 258 ms y la siguiente acción empezó en 259 ms.
La señal de ese ensayo entró como evento nativo construido para la prueba;
la pulsación desde un cliente real es la validación del usuario registrada
arriba. No se enviaron mensajes a otros usuarios. Esta evidencia verifica
la concurrencia técnica con proveedor y Telegram reales, pero no equivale
a una prueba presencial simultánea con dos cuentas de Telegram.

Esta revisión pasó 1.114 tests seleccionados por impacto, typecheck, lint,
documentación e inventario. `./startup.sh` completó build y despliegue;
se comprobaron servicio activo, Node efectivo 24.21.0, grammY 1.46.0,
runner 2.0.3, portada pública 200 y admin sin sesión 303. El registro
operativo P-040 queda completado con ese alcance y la limitación indicada.
