# Revisión técnica y oportunidades de Telegram

Fecha: 2026-10-09.

La revisión no encuentra motivos para reescribir el bot por haberse iniciado con
un modelo anterior. Su arquitectura actual es razonable para un club: un servicio
TypeScript estricto, PostgreSQL, repositorios por dominio, permisos locales,
sesiones persistentes y pruebas de regresión. Sí hay mantenimiento urgente del
runtime y problemas concretos de concurrencia, acceso web y fiabilidad de envíos.

Este documento es una fotografía de investigación. No cambia capacidades ni
sustituye `feature-status.md` o `PENDING.md`. Las versiones disponibles deben
volverse a consultar antes de implementar una actualización.

## Alcance y comprobaciones

- Inspección de arquitectura, bootstrap, boundary Telegram, sesiones, IA,
  recordatorios, repositorios, esquema, panel HTTP, CI y backlog.
- Comparación del lockfile del repositorio y de `/opt/gameclubtelegrambot`:
  coinciden las versiones principales examinadas.
- Servicio activo; systemd ejecuta `/usr/bin/node`, también confirmado mediante
  el ejecutable del proceso. Su versión instalada es **20.19.2**.
- Consulta en vivo del registro npm, avisos de seguridad y documentación oficial
  de Node.js, grammY y Telegram.
- `npm run typecheck`, `npm run lint` y `npm run docs:check`: correctos.
- 77 pruebas focalizadas de boundary, reintentos, sesiones, flujo LLM,
  recordatorios de Agenda y servidor HTTP: correctas, sin omisiones.
- `npm audit --omit=dev`: cero vulnerabilidades conocidas reportadas.
- `npm audit`: cuatro entradas moderadas, relacionadas principalmente con una
  cadena transitiva de herramientas de desarrollo.

No se ha ejecutado toda la suite ni una nueva validación de integración con
PostgreSQL. Tampoco se han enviado mensajes, provocado bloqueos en producción,
actualizado paquetes o reiniciado el servicio. Las hipótesis de fallo ante caídas
se distinguen abajo de los comportamientos comprobados en código.

## Lo que merece corregirse

### 1. Node.js fuera de soporte — prioridad alta

El runtime efectivo es Node 20.19.2. CI fija 20.19.0 y `package.json` permite
`>=20.19.0`, por lo que la configuración mantiene una rama obsoleta. Node 20
terminó su soporte oficial el 30 de abril de 2026, según el
[calendario oficial](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json).

Recomendación: migrar a **Node 24 LTS**, alineando host, servicio, CI, requisito
del proyecto y tipos de Node. Validar compilación, migraciones, pruebas y wrappers
de operación con ese runtime. A fecha de revisión Node 26 aún es Current; no lo
elegiría para este despliegue sólo por ser la versión mayor más reciente.
[Estados oficiales de Node.js](https://nodejs.org/en/about/previous-releases).

### 2. Una tarea lenta retrasa a otros usuarios — prioridad alta

[`runtime-boundary-support.ts`](../src/telegram/runtime-boundary-support.ts)
inicia `bot.start()`. En el grammY instalado, `handleUpdates` espera cada
`handleUpdate` antes de pasar al siguiente. Los handlers esperan a Codex,
descargas e importaciones; la generación de imágenes espera su proceso externo.
Los timeouts declarados de IA son de 60 segundos para órdenes naturales y
180 segundos para imágenes. No son mediciones de duración real.

Por tanto, una llamada lenta puede dejar pendientes los mensajes de todos los
usuarios del bot. Los mensajes de progreso mejoran la información, pero no
liberan el procesamiento de la siguiente actualización. Esto afecta a Telegram;
una espera asíncrona no implica por sí misma que el servidor HTTP quede bloqueado.

Recomendación: procesamiento concurrente limitado con orden conservado por sesión,
o una cola de trabajos para las operaciones largas. grammY proporciona
[`runner` y `sequentialize`](https://grammy.dev/advanced/scaling).

No basta con lanzar promesas sin esperarlas. Las sesiones actuales se leen y
sobrescriben sin control de versión en
[`conversation-session-store.ts`](../src/telegram/conversation-session-store.ts).
Hay que serializar las actualizaciones de una misma conversación **antes** de
cargar su sesión, y conservar las restricciones de base de datos. Criterio de
validación: una operación lenta de A permite responder a B, mientras dos acciones
de A mantienen orden y no pierden estado.

### 3. El rate limit del panel agrupa a los clientes de Nginx — prioridad alta

`loginAttemptKey` en
[`admin-http-server.ts`](../src/http/admin-http-server.ts) usa exclusivamente
`request.socket.remoteAddress`. El Nginx instalado conecta a `127.0.0.1:8787` y
envía `X-Real-IP` y `X-Forwarded-For`, que esa función no utiliza.

Cinco fallos dentro de quince minutos bloquean esa clave. Con el proxy actual,
distintos clientes comparten la dirección de Nginx; una persona puede impedir
temporalmente nuevos accesos de otros administradores. No he provocado el bloqueo
en producción. El backlog ya recoge el problema como **P-009**.

Recomendación: obtener la IP mediante un proxy de confianza explícito o aplicar
el límite en Nginx. No confiar indiscriminadamente en una cabecera enviada por
el cliente. Validar dos clientes distintos y cabeceras falsificadas.

### 4. Envíos y persistencia tienen ventanas de duplicación — prioridad media

En [`schedule-reminders.ts`](../src/schedule/schedule-reminders.ts) se comprueba
si hubo envío, se envía a Telegram y luego se registra en PostgreSQL. Las compras
conjuntas usan el mismo patrón. Si el proceso cae después del envío y antes del
registro, la siguiente ejecución puede repetir el recordatorio. El índice único
evita duplicar registros; no evita que Telegram reciba dos mensajes.

Además, [`telegram-api-retry.ts`](../src/telegram/telegram-api-retry.ts) reintenta
errores de red y 5xx también en operaciones de envío. Cuando Telegram aceptó un
mensaje pero se perdió su respuesta, un reintento puede duplicarlo. Son escenarios
derivados del código, no incidentes demostrados en esta revisión.

Recomendación: cola persistente de entregas con clave lógica única, estados,
reclamación por worker y diagnóstico de fallos. Una outbox mejora la recuperación
y reduce duplicaciones, pero no garantiza por sí sola un único envío frente a una
respuesta perdida del servicio externo. Definir expresamente esa limitación.

### 5. El asistente ofrece acciones que no prepara — prioridad media

[`llm-command-actions.ts`](../src/telegram/llm-command-actions.ts) declara
`schedule.create`, `group_purchase.create` y `storage.entry.edit`. Sin embargo,
`prepareConfirmedWrite` en
[`llm-command-flow.ts`](../src/telegram/llm-command-flow.ts) no las implementa y
la confirmación puede terminar en `unsupportedPrefill`. Corresponde a **P-002**.

Recomendación: conectar esos intents a los flujos existentes con prellenado y
permisos, o ajustar lo que se ofrece al usuario. El contrato de capacidades debe
reflejar las acciones realmente disponibles.

### 6. Hay puntos de concentración que encarecen el mantenimiento

El servidor HTTP tiene 6.402 líneas y el registro de handlers Telegram 4.337.
Esto no demuestra un fallo funcional, pero dificulta revisar permisos, routing y
dependencias cuando crecen las features.

Recomendación: extraer rutas, vistas y registros por dominio de forma gradual,
manteniendo el único servicio. No hay evidencia que justifique migrar a
microservicios o cambiar PostgreSQL, Drizzle o grammY.

## Dependencias: versiones comprobadas

Las versiones actuales son las instaladas/resueltas; no los mínimos escritos en
`package.json`. `wanted` es la versión admitida por los rangos actuales.

| Paquete | Actual | Wanted | Latest | Propuesta |
| --- | --- | --- | --- | --- |
| grammy | 1.42.0 | 1.46.0 | 1.46.0 | Prioritario: soporte de Bot API 10.3 |
| drizzle-orm | 0.45.2 | 0.45.4 | 0.45.4 | Actualizar con validación de persistencia |
| drizzle-kit | 0.31.10 | 0.31.11 | 0.31.11 | Validar artefactos y migraciones |
| pg | 8.20.0 | 8.23.1 | 8.23.1 | Actualización dentro de la major actual |
| zod | 4.3.6 | 4.6.5 | 4.6.5 | Validar configuración y schemas |
| tsx | 4.21.0 | 4.23.15 | 4.23.15 | Validar scripts y runner de pruebas |
| pino | 9.14.0 | 9.14.0 | 10.4.0 | Cambio de major separado |
| typescript | 5.9.3 | 5.9.3 | 7.0.2 | Migración de compilador separada |
| @types/node | 24.12.2 | 24.19.1 | 26.6.4 | Mantener alineado con Node 24 propuesto |
| @types/pg | 8.20.0 | 8.23.1 | 8.23.1 | Alinear con pg |

`blessed` y `@types/blessed` no aparecen como desactualizados en esta consulta.
Eso no equivale a certificar su mantenimiento futuro.

grammY 1.46.0 añade soporte de Bot API 10.3 y correcciones de manejo de señales y
errores. [Release oficial](https://github.com/grammyjs/grammY/releases/tag/v1.46.0).
Actualizar grammY no habilita automáticamente funciones que nuestro adaptador no
expone. El polling acepta únicamente `message` y `callback_query`.

El audit completo identifica principalmente `drizzle-kit` →
`@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → una versión antigua de
`esbuild`. El aviso moderado afecta a su servidor de desarrollo, cuyo uso no he
encontrado en el arranque del bot. Hay también un aviso de menor gravedad para
otra versión de esbuild en Windows. Ver
[aviso del servidor de desarrollo](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
y [aviso de Windows](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).

El resultado no demuestra una explotación del servicio de producción. Tampoco
debe aplicarse ciegamente `npm audit fix --force`: la solución que npm propone
para esa cadena es bajar `drizzle-kit` a 0.18.1. La actualización a 0.31.11 debe
comprobarse de nuevo; no se ha verificado que elimine esa cadena.

## Telegram: oportunidades que faltan

La documentación oficial consultada identifica **Bot API 10.3**, publicada el
24 de agosto de 2026. El grammY instalado soporta la generación 9.6; las llamadas
actuales no están necesariamente rotas por ello. Las siguientes propuestas se
han contrastado con el adaptador y el inventario.
[Changelog oficial](https://core.telegram.org/bots/api#recent-changes).

| Capacidad | Aplicación propuesta al club | Requisitos principales |
| --- | --- | --- |
| Mensajes efímeros | Mostrar al socio su inscripción dentro del grupo, sólo para él | Extender envíos, identidad de mensaje y edición; revisar permisos y política de respuestas |
| Rich messages | Agenda y catálogo con tablas y bloques interactivos | Añadir renderizador y fallback a mensajes actuales |
| Drafts y Stop | Progreso nativo y cancelación de tareas IA | Cancelar el proceso real y recibir el update de parada |
| Botones deshabilitados | Mostrar acciones agotadas o temporalmente ocupadas | Extender contrato de botones; revalidar estado en servidor |
| Topics privados | Separar conversaciones por campaña o tarea | Habilitar en BotFather y separar sesiones por thread |
| Encuestas ampliadas | Elegir juego o fecha | Persistir encuesta y habilitar recepción de respuestas |
| Guest mode | Consultas públicas desde chats donde el bot no está añadido | Handler nuevo y frontera de permisos explícita |
| Communities | Organizar grupos y canales del club | Evaluar utilidad respecto a la estructura actual |

Las cuatro primeras capacidades se documentan en
[Bot API](https://core.telegram.org/bots/api) y
[funciones de bots](https://core.telegram.org/bots/features). Los mensajes
efímeros no garantizan recepción, especialmente con usuarios desconectados:
no reemplazarían recordatorios duraderos.

Los topics privados requieren cambiar la clave actual de sesión
`telegram.session:<chatId>:<userId>`; hoy dos topics del mismo usuario compartirían
estado. No los activaría antes de adaptar y probar ese aislamiento.

Las encuestas son una propuesta de UX, no un sustituto automático de una
inscripción persistida. La pertenencia a un grupo no equivale a aprobación como
socio. Guest mode tampoco debe abrir información privada del catálogo, Storage
o Rol. Los botones deshabilitados son una ayuda visual, no un permiso.

**Mini App de Agenda:** no es una novedad exclusiva de 2026, pero es una oportunidad
real que el bot no usa. Podría reutilizar las reglas y el servidor HTTP existentes
para mostrar calendario, mesas y formularios dentro de Telegram. Requiere
validación en servidor de `initData`, caducidad y autorización local; no basta
con confiar en el user ID enviado desde el navegador. El enlace web personal
actual no se convierte automáticamente en autenticación de Mini App.
[Documentación oficial](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

## Orden propuesto

1. Migrar Node a 24 LTS y alinear CI; actualizar grammY y dependencias compatibles
   en cambios revisables con validación de impacto transversal.
2. Resolver el rate limit del proxy y el retraso global por tareas lentas, con
   pruebas que cubran clientes/sesiones independientes.
3. Corregir el contrato de acciones LLM y mejorar la recuperación de entregas.
4. Probar una vista efímera de inscripción en grupos; decidir su UX antes de
   cambiar la política actual de respuestas privadas.
5. Evaluar rich messages y una Mini App de Agenda según utilidad real. Mantener
   Pino y TypeScript major como migraciones separadas.

La arquitectura de un único servicio, el long polling y los repositorios
actuales pueden mantenerse. El mayor beneficio inmediato está en soporte del
runtime y aislamiento de operaciones lentas, seguido de mejoras de UX concretas.
