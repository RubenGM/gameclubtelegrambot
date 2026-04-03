# PLAN de Implementación

Este documento describe el orden recomendado para construir `Game Club Telegram Bot`.

## Objetivos del plan

- construir una base técnica estable antes de añadir flujos complejos
- evitar mezclar reglas de dominio con lógica de Telegram
- dejar trazabilidad clara de permisos, reservas y préstamos
- llegar a una primera versión completa y operativa en Debian

## Principios de ejecución

- cada fase debe dejar el sistema en estado ejecutable
- las migraciones de base de datos deben acompañar a cada cambio de dominio
- la lógica de negocio debe probarse fuera de Telegram cuando sea posible
- los flujos conversacionales deben diseñarse por pasos y con validación robusta
- cada capacidad administrativa debe incluir control de permisos desde el inicio

## Fase 1. Base del proyecto

Objetivo:

- crear la base técnica del servicio

Entregables:

- proyecto `Node.js` con `TypeScript`
- estructura inicial de carpetas
- configuración por entorno
- conexión a `PostgreSQL`
- sistema de migraciones
- logging básico
- arranque principal del bot
- comandos de desarrollo y producción

Stack técnico ya fijado:

- `grammY` para Telegram
- `Drizzle ORM` para persistencia
- `drizzle-kit` para migraciones
- `zod` para validación de configuración
- `pino` para logging estructurado

Decisiones a cerrar en esta fase:

- formato exacto del archivo JSON de configuración inicial
- alineación final entre configuración de bootstrap y configuración runtime cargada en arranque
- estructura exacta de carpetas y módulos
- estrategia de separación entre dominio, infraestructura y capa Telegram

## Fase 2. Bootstrap inicial

Objetivo:

- permitir dejar el sistema operativo en un primer arranque seguro

Entregables:

- comando o utilidad CLI de inicialización
- preguntas guiadas en terminal
- validación de respuestas
- generación del `config/runtime.json` o migración explícita al formato y ruta runtime vigentes
- creación del primer administrador aprobado
- protección contra reinicialización accidental

Casos a cubrir:

- primera ejecución sin configuración
- error en parámetros obligatorios
- reintento seguro del asistente

## Fase 3. Núcleo de Telegram

Objetivo:

- construir la base conversacional del bot

Entregables:

- router de comandos y acciones
- detección del contexto del chat: privado o grupo
- middleware de autorización
- sesiones conversacionales por usuario
- respuestas base de ayuda, estado y navegación

Casos a cubrir:

- usuario no aprobado
- usuario aprobado sin permisos suficientes
- admin en privado
- comandos permitidos en grupos

## Fase 4. Usuarios y permisos

Objetivo:

- controlar quién entra y qué puede hacer

Entregables:

- solicitud de acceso al club
- bandeja de aprobaciones para administradores
- activación y desactivación de usuarios
- rol de administrador
- permisos globales
- permisos específicos por recurso

Ejemplos de permisos específicos a implementar:

- reservar mesa concreta
- retirar juego concreto
- bloquear acciones de agenda a un usuario concreto

## Fase 5. Gestión de mesas

Objetivo:

- registrar la estructura física del local

Entregables:

- CRUD de mesas
- campos de nombre, descripción y aforo recomendado
- listados y consultas desde privado
- consulta resumida desde grupo si aplica

## Fase 6. Agenda del club

Objetivo:

- permitir crear y gestionar actividad habitual del club

Entregables:

- crear actividad
- editar actividad
- cancelar actividad
- apuntarse a plazas libres
- salir de una actividad
- listar actividades por fecha
- detalle de participantes

Reglas importantes:

- permitir solapes
- detectar conflictos potenciales
- avisar por privado a usuarios afectados
- soportar mesa opcional

## Fase 7. Eventos que afectan al local

Objetivo:

- representar eventos especiales distintos de la agenda normal

Entregables:

- crear evento especial
- editar y cancelar evento
- indicar rango horario
- marcar ocupación total o relevante del local
- reflejar el impacto en consultas y avisos

## Fase 8. Catálogo de juegos

Objetivo:

- disponer de inventario estructurado del material del club

Entregables:

- alta manual de juegos
- edición de fichas
- agrupación por familia o línea
- soporte para expansiones
- soporte para libros de rol
- imágenes y metadatos principales

Metadatos mínimos:

- título
- descripción
- jugadores recomendados
- edad recomendada
- duración estimada

## Fase 9. Integración con BoardGameGeek

Objetivo:

- acelerar el alta de juegos mediante importación asistida

Entregables:

- búsqueda por nombre contra BGG
- selección de coincidencias
- importación de datos disponibles
- pantalla o flujo de revisión antes de guardar
- edición manual posterior

Riesgos a resolver:

- coincidencias ambiguas
- datos incompletos
- normalización de imágenes y descripciones

## Fase 10. Préstamos y devoluciones

Objetivo:

- saber qué material está fuera del club y quién lo tiene

Entregables:

- crear préstamo
- aprobar o registrar retirada
- registrar devolución
- consultar estado actual de un juego
- consultar préstamos activos por usuario
- alertas básicas por devolución pendiente

Integración esperada:

- aviso al consultar o reservar actividad con un juego no disponible en el local

## Fase 11. Noticias en grupos

Objetivo:

- convertir grupos del club en receptores configurables de avisos

Entregables:

- comando para activar `modo noticias` en un grupo
- alta de grupo suscrito
- selección de categorías de aviso por grupo
- activación y desactivación por categoría
- plantillas de mensajes para cada tipo de aviso

Categorías iniciales recomendadas:

- nuevas reservas
- cambios en reservas
- cancelaciones
- préstamos
- devoluciones
- creación de eventos
- cancelación de eventos

## Fase 12. Auditoría, estabilidad y despliegue final

Objetivo:

- dejar el sistema listo para operación continuada

Entregables:

- auditoría mínima de acciones administrativas
- endurecimiento de validaciones
- manejo robusto de errores externos
- documentación de despliegue en Debian
- fichero de servicio `systemd`
- estrategia de backup y restauración
- pruebas de humo y checklist operativa

## Dependencias entre fases

- Fase 2 depende de Fase 1.
- Fase 3 depende de Fase 1 y de parte de Fase 2.
- Fase 4 depende de Fase 3.
- Fases 5, 6, 7, 8 y 10 dependen de Fase 4.
- Fase 9 depende de Fase 8.
- Fase 11 depende de Fases 3, 6, 7 y 10.
- Fase 12 depende de todas las anteriores.

## Riesgos principales

- complejidad de permisos finos por usuario y por juego
- modelado correcto de conflictos en agenda sin bloquear en exceso
- UX conversacional larga dentro de Telegram
- consistencia entre inventario, préstamos y agenda
- calidad y límites de datos importados desde BoardGameGeek

## Criterios de aceptación de la primera versión completa

- el sistema puede inicializarse desde terminal en una máquina Debian limpia
- el bot arranca automáticamente como servicio del sistema
- un usuario puede solicitar acceso y un admin puede aprobarlo
- un admin puede crear mesas, juegos y eventos
- un miembro aprobado puede crear actividades y otros pueden apuntarse
- el sistema avisa de conflictos potenciales sin bloquear reservas
- los préstamos muestran quién tiene cada juego y hasta cuándo
- los grupos configurados reciben noticias según sus categorías activas

## Orden de trabajo recomendado dentro de cada fase

- cerrar modelo de datos
- implementar casos de uso
- exponer flujo Telegram
- validar permisos
- añadir pruebas
- documentar comportamiento

## Resultado esperado

Al final del plan el club dispondrá de un bot usable como herramienta central de operación diaria, desplegable en Debian y administrable completamente desde Telegram.
