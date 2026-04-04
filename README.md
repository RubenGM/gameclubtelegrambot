# Game Club Telegram Bot

Bot de Telegram para gestionar un club de juegos de mesa, rol, wargames y otras actividades similares.

## Estado actual del repositorio

La base técnica inicial ya está creada.

- proyecto `Node.js` con `TypeScript`
- compilación de `src/` a `dist/`
- logging básico con `pino`
- carga centralizada de configuración runtime con validación `zod`
- conexión real a `PostgreSQL`
- esquema y migraciones con `Drizzle ORM` y `drizzle-kit`
- integración real con `Telegram Bot API` mediante `grammY` y `long polling`
- arranque inicial del proceso con límites explícitos para Telegram y base de datos

Ya existe un asistente interactivo de primer arranque en terminal que persiste la configuracion validada y crea el primer administrador aprobado.

La integración inicial de Telegram ya autentica el bot, levanta `long polling` y expone una respuesta mínima para `/start`.

El runtime principal también registra shutdown controlado y manejo definido para `SIGINT`, `SIGTERM`, `uncaughtException` y `unhandledRejection`.

## Puesta en marcha local

Requisitos:

- `Node.js >= 20.19.0`

Comandos principales:

- `npm install`
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run start`
- `npm run bootstrap:wizard`
- `npm run db:generate`
- `npm run db:migrate`

Para desarrollo:

- `npm run dev`

Preparación local rápida después de `git clone`:

- `npm run init:local`

Esto deja preparado:

- `PostgreSQL` local en Docker
- `config/runtime.local.json`
- migraciones aplicadas

La base de datos local integrada del repositorio se publica por defecto en `127.0.0.1:55432` para evitar conflictos con otros `PostgreSQL` ya instalados en la máquina.

Después solo tendrás que sustituir el token real de Telegram en `config/runtime.local.json` si no lo pasaste mediante `GAMECLUB_TELEGRAM_TOKEN`.

## Configuración runtime actual

El proceso espera un archivo JSON de configuración en:

- `config/runtime.json`

La ruta puede sobreescribirse con la variable de entorno:

- `GAMECLUB_CONFIG_PATH`

Si el archivo no existe, el JSON es inválido o algún campo no cumple el contrato, el proceso aborta el arranque con un error fatal claro.

Si la configuración es válida pero `PostgreSQL` no responde o rechaza la conexión, el proceso también aborta el arranque con un error fatal predecible.

La estructura runtime actual cubre:

- `schemaVersion`
- `bot`
- `telegram`
- `database`
- `adminElevation`
- `bootstrap`
- `notifications`
- `featureFlags`

Hay una guía más concreta en `docs/runtime-configuration.md`.

Tambien hay una guía específica del asistente interactivo en `docs/bootstrap-wizard.md`.

El fichero runtime persistido ya no guarda la contrasena de elevacion administrativa en texto plano. Ahora guarda `adminElevation.passwordHash`.

## Persistencia y migraciones

El repositorio usa:

- `pg` como driver de PostgreSQL
- `Drizzle ORM` para acceso tipado a la base de datos
- `drizzle-kit` para generar migraciones SQL versionadas

Workflow canónico:

- definir o actualizar tablas en `src/infrastructure/database/schema.ts`
- generar una migración nueva con `npm run db:generate`
- aplicar migraciones con `npm run db:migrate`
- arrancar la aplicación con `npm run start`

Workflow local integrado en el repo:

- levantar PostgreSQL local con `npm run db:up`
- aplicar migraciones locales con `npm run db:migrate:local`
- arrancar el bot con `npm run start:local`
- ver logs de PostgreSQL con `npm run db:logs`

La aplicación valida primero la configuración runtime y después verifica conectividad real con la base de datos antes de considerarse arrancada.

Durante el arranque y la parada se registran hitos explícitos para facilitar diagnóstico operativo.

La primera migración generada crea la tabla `app_metadata`, que actúa como base mínima para validar el workflow de esquema y migraciones desde esta fase inicial.

El objetivo del proyecto es centralizar desde Telegram la operativa habitual del club:

- agenda y reservas de actividades
- gestión de mesas
- gestión de usuarios y permisos
- catálogo e inventario de juegos
- préstamos y devoluciones
- eventos que afectan al local
- avisos automáticos en grupos del club

## Visión

El bot estará pensado para uso interno de un club.

- En chat privado ofrecerá toda la funcionalidad.
- En grupos ofrecerá principalmente consultas, lectura y avisos.
- Algunos grupos podrán activarse en `modo noticias` para recibir avisos automáticos por categorías.

El proyecto se desplegará en un PC con Debian y se ejecutará como servicio del sistema al arrancar el equipo.

## Objetivos

- Permitir a los miembros del club gestionar su actividad habitual sin salir de Telegram.
- Mantener un control claro sobre quién puede acceder al bot y qué acciones puede realizar.
- Organizar la ocupación del local, las mesas y los juegos disponibles.
- Hacer visibles los préstamos y el estado del inventario.
- Facilitar la administración del club sin obligar a usar paneles web externos.
- Mantener una base técnica simple de operar en una máquina Debian doméstica o semiprofesional.

## Alcance funcional

La primera versión funcional prevista incluye todas estas áreas.

### 1. Agenda del club

Los miembros podrán crear actividades indicando, como mínimo:

- fecha
- hora de inicio
- actividad o juego
- persona organizadora
- número de plazas o jugadores
- mesa opcional
- descripción opcional

Ejemplo:

`Sábado 4 de abril - 16:00 - RubénGM - Dungeons & Dragons - 5 personas - Mesa TV`

Comportamiento esperado:

- Un usuario puede crear una actividad y reservar sus plazas iniciales.
- Otros usuarios pueden apuntarse a las plazas libres.
- Se puede consultar quién estará en el club y a qué actividad acudirá.
- Los administradores pueden modificar o cancelar reservas de cualquier usuario.
- Los solapes están permitidos.
- Si una reserva entra en conflicto potencial con otra, el bot avisará por privado a los usuarios afectados para que puedan coordinarse.

### 2. Gestión de mesas

Funcionalidad solo para administradores.

Cada mesa tendrá:

- nombre identificativo
- descripción opcional
- número máximo de jugadores recomendado

Operaciones previstas:

- crear mesa
- editar mesa
- listar mesas
- desactivar o eliminar mesa

Las mesas serán informativas y ayudarán a organizar el local, pero no impondrán bloqueo estricto sobre reservas solapadas.

### 3. Gestión de usuarios

Modelo de acceso cerrado:

- un usuario no aprobado solo puede solicitar acceso
- un administrador aprueba o rechaza la solicitud
- un usuario aprobado puede usar el bot según sus permisos

Capacidades administrativas:

- aprobar usuarios
- bloquear usuarios
- marcar usuarios como administradores
- retirar permisos globales o específicos

El sistema debe soportar permisos granulares como:

- reservar mesas
- reservar una mesa concreta
- sacar juegos del club
- sacar un juego concreto
- gestionar agenda
- gestionar usuarios
- gestionar inventario

Ejemplo de permiso fino:

- un usuario puede quedar bloqueado para retirar `Bang`, pero seguir pudiendo retirar cualquier otro juego

### 4. Gestión de juegos

El catálogo debe soportar:

- juegos de mesa
- expansiones
- libros de rol
- material agrupado por línea o juego principal

Cada ficha de juego podrá incluir:

- título
- descripción
- imágenes
- número de jugadores recomendado
- edad recomendada
- duración estimada de partida
- información agrupada bajo una familia o línea de juego

Alta de juegos:

- manual
- asistida por búsqueda en BoardGameGeek

### 5. Integración con BoardGameGeek

Se integrará la API `BGG XML API2` para facilitar el alta de juegos.

Flujo previsto:

- el administrador busca un juego por nombre
- el bot muestra coincidencias
- el administrador elige una
- el sistema importa los datos disponibles
- antes de guardar, se podrán revisar y editar los campos manualmente

La integración servirá para acelerar el alta de juegos, pero el catálogo local seguirá siendo la fuente de verdad final.

## 6. Reserva y préstamo de juegos

Los usuarios podrán solicitar llevarse juegos del club.

Cada préstamo deberá registrar:

- juego o elemento prestado
- usuario responsable
- fecha del préstamo
- fecha prevista de devolución
- observaciones opcionales

Capacidades previstas:

- solicitar préstamo
- aprobar o registrar préstamo
- registrar devolución
- consultar quién tiene un juego
- advertir cuando un juego no está en el local

Cuando un usuario quiera organizar una actividad con un juego prestado, el bot mostrará qué usuario lo tiene para facilitar la coordinación.

## 7. Gestión de eventos

El sistema permitirá crear eventos especiales que afecten al uso del local.

Cada evento podrá incluir:

- nombre
- descripción
- fecha
- rango horario
- número estimado de asistentes
- indicación de que ocupa todo el local o una parte relevante

Los eventos podrán convivir con la agenda normal, pero deben generar avisos claros y servir como contexto para detectar conflictos.

## 8. Noticias y avisos en grupos

El bot podrá añadirse a grupos normales del club.

Un administrador podrá activar en cada grupo el `modo noticias` mediante comando.

Cada grupo configurado podrá elegir qué categorías de avisos quiere recibir, por ejemplo:

- nuevas reservas de agenda
- cambios en reservas
- cancelaciones
- préstamos de juegos
- devoluciones
- creación de eventos
- cancelación de eventos

Esto permitirá que cada club organice varios grupos con finalidades distintas.

## 9. Inicialización del sistema

En el primer arranque no habrá configuración previa.

Se ejecutará un asistente local en terminal que generará un archivo JSON con la configuración inicial del bot. La ruta runtime actual por defecto es `config/runtime.json`, y el bootstrap futuro deberá alinearse con ese contrato o migrarlo de forma explícita.

Este asistente deberá pedir, como mínimo:

- nombre público del bot
- nombre del club
- icono o ruta a imagen si aplica
- token del bot de Telegram
- contraseña de elevación a administrador
- datos del primer administrador
- configuración básica de base de datos
- ajustes iniciales de avisos y comportamiento

Resultados del bootstrap:

- creación del archivo de configuración JSON
- validación de parámetros mínimos
- creación del primer usuario administrador ya aprobado
- preparación del sistema para ejecución normal como servicio

## Modelo de acceso y seguridad

Decisiones de diseño ya fijadas:

- el bot es de uso interno, no público
- solo miembros aprobados pueden usar la funcionalidad real
- la contraseña de administrador no sirve para entrar desde cero
- la contraseña de administrador solo eleva a administrador a usuarios ya aprobados
- el bootstrap inicial crea un usuario inicial aprobado para evitar bloqueo operativo

## Contextos de uso en Telegram

### Chat privado

En privado estarán disponibles todas las acciones principales:

- alta y gestión de reservas
- alta y consulta de préstamos
- gestión personal de usuario
- solicitudes de acceso
- acciones administrativas

### Grupos

En grupos el bot estará orientado a:

- consultas rápidas
- listados o resúmenes
- avisos automáticos
- redirección a privado para acciones sensibles

## Arquitectura técnica prevista

Stack recomendado y aceptado para el proyecto:

- `Node.js`
- `TypeScript`
- `PostgreSQL`
- `grammY` para integración con Telegram
- `Drizzle ORM` para acceso a datos
- `drizzle-kit` para migraciones
- `zod` para validación de configuración y entradas estructuradas
- `pino` para logging
- servicio `systemd` en Debian
- integración con Telegram por `long polling` en la primera versión

### Motivos de la elección

- despliegue simple en Debian
- buena mantenibilidad del dominio con tipado fuerte
- facilidad para modelar permisos, reservas y estados
- buena integración con procesos persistentes y herramientas de sistema
- evita la complejidad inicial de exponer webhooks públicos

### Decisiones técnicas cerradas

- Librería de Telegram: `grammY`
- ORM principal: `Drizzle ORM`
- Migraciones: `drizzle-kit`
- Validación de configuración: `zod`
- Logging: `pino`

Razonamiento:

- `grammY` encaja bien con TypeScript, middlewares y flujos conversacionales por contexto.
- `Drizzle ORM` ofrece tipado fuerte y control explícito del esquema sin ocultar demasiado SQL.
- `drizzle-kit` permite mantener migraciones revisables dentro del repositorio.
- `zod` simplifica la validación del `config.json`, variables de entorno y payloads internos.
- `pino` permite logs estructurados y ligeros para operación en Debian.

## Modelo conceptual de datos

Entidades principales previstas:

- `User`
- `UserPermission`
- `Role`
- `Table`
- `GameGroup`
- `GameItem`
- `GameImage`
- `Loan`
- `ScheduleEvent`
- `ScheduleParticipant`
- `VenueEvent`
- `NewsChannel`
- `NewsCategory`
- `BotConfig`
- `AuditLog`

Relaciones importantes:

- un usuario tiene permisos globales y específicos
- una actividad de agenda puede tener una mesa opcional
- una actividad puede tener múltiples participantes
- un juego puede pertenecer a una familia o línea
- un préstamo apunta a un elemento concreto del inventario
- un grupo de Telegram puede suscribirse a varias categorías de noticias

## Reglas funcionales destacadas

- Los solapes de agenda no se bloquean automáticamente.
- Los conflictos generan avisos privados a los usuarios afectados.
- Las mesas son organizativas, no un sistema rígido de exclusividad.
- Los grupos del club pueden suscribirse solo a las categorías de avisos que necesiten.
- El catálogo local puede enriquecerse desde BoardGameGeek, pero siempre será editable manualmente.

## Despliegue previsto en Debian

El objetivo operativo es:

- instalar dependencias en el PC del club
- configurar PostgreSQL local o accesible por red local
- ejecutar el bootstrap inicial una sola vez
- levantar el bot como servicio `systemd`
- asegurar arranque automático al iniciar el sistema

Más adelante se documentarán:

- fichero de servicio `systemd`
- estrategia de backups
- actualización del bot
- restauración del sistema

## Principios de implementación

- priorizar flujos conversacionales claros dentro de Telegram
- mantener un dominio bien tipado y desacoplado de Telegram
- registrar cambios relevantes con trazabilidad administrativa
- separar permisos, reglas de negocio y presentación de mensajes
- favorecer configuración sencilla para clubes pequeños o medianos

## Estado actual

Actualmente el repositorio ya dispone de una base técnica mínima y ejecutable.

Estado implementado hasta ahora:

- esqueletado inicial de `Node.js` + `TypeScript`
- estructura base de carpetas
- scripts de desarrollo, pruebas, compilación y arranque
- validación centralizada de configuración runtime con `zod`
- errores fatales de arranque cuando falta o falla la configuración

Pendiente de implementación:

- bootstrap inicial interactivo
- conexión real a `PostgreSQL`
- migraciones con `drizzle-kit`
- integración con `grammY`
- módulos funcionales del dominio

## Plan de implementación

El detalle por fases está documentado en `PLAN.md`.
