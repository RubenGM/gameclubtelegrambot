---
name: gameclub-drizzle
description: Modificar schemas, consultas y migraciones Drizzle del bot Game Club con PostgreSQL. Usar al trabajar en src/infrastructure/database/schema.ts, drizzle/ o persistencia SQL.
metadata:
  upstream: https://github.com/lobehub/lobehub/tree/03a5c1d624089841ffe1037746b60f292e37ea80/.agents/skills/drizzle
  reviewed: '2026-10-21'
  maintenance: project
---

# Drizzle en Game Club

Contexto propio del repositorio, complementario a la skill externa `drizzle`.
Las rutas, helpers y políticas de LobeHub no describen Game Club. Consultar sus
patrones generales sólo cuando encajen con la persistencia existente. Las reglas
generales de validación y entrega viven en [AGENTS.md](../../../AGENTS.md).

## Ubicaciones y referencias

- Configuración: `drizzle.config.ts`.
- Schema: `src/infrastructure/database/schema.ts`.
- Conexión: `src/infrastructure/database/connection.ts`.
- Migraciones SQL, journal y snapshots: `drizzle/` y `drizzle/meta/`.
- Aplicación: `src/infrastructure/database/apply-migrations.ts`.
- Flujo de desarrollo: `docs/development-and-validation.md`, apartado de base
  de datos. Consultar también los scripts `db:*` de `package.json`.

Leer la implementación de persistencia del dominio afectado antes de cambiar
una consulta. Comprobar las versiones instaladas de `drizzle-orm` y
`drizzle-kit`; para dudas de API, usar la documentación oficial de Drizzle
correspondiente a esas versiones.

## Schema y consultas

- Seguir los nombres de tablas y columnas en `snake_case` y los símbolos
  TypeScript existentes. Mantener la familia de nombres de cada dominio.
- Conservar la estrategia de claves de las tablas cercanas: aquí existen
  Telegram IDs y `bigserial`. No imponer los generadores de IDs, helpers,
  prohibiciones de enums o claves compuestas de otro proyecto.
- Usar timestamps con zona horaria para instantes, conforme al schema actual;
  mantener la conversión de la hora del club en la capa que ya la resuelve.
- Revisar nulabilidad, valores por defecto, referencias, índices y unicidad
  junto a los consumidores. Tipar JSONB según los datos que realmente se guardan.
- Preferir consultas explícitas con `select`, filtros y joins, siguiendo la
  persistencia existente. Usar parámetros o plantillas `sql` de Drizzle para
  valores externos; no concatenarlos en SQL.
- Mantener las transacciones y bloqueos existentes cuando protegen invariantes
  del dominio. Comprobar conflictos y escrituras concurrentes al modificar
  reservas, préstamos o asignaciones; una comprobación previa aislada puede
  quedar obsoleta antes de escribir.
- Añadir índices por patrones de acceso concretos. Para optimizar, estudiar el
  plan de consulta y el volumen de datos antes de cambiar el schema.

## Migraciones y validación

Después de modificar el schema, generar los artefactos con el wrapper del repo:

```bash
npm run db:generate
npm run db:check
npm run db:check:state
```

`db:generate` valida los artefactos previos y revierte una generación inválida.
Revisar SQL, journal y snapshot juntos. No modificar migraciones ya aplicadas
para introducir cambios nuevos; crear otra migración. No usar `drizzle-kit push`
para sustituir este historial.

Para comprobar la aplicación, usar una base de pruebas configurada explícitamente
y `npm run db:migrate`; distinguir la validación de artefactos de una aplicación
real. Cubrir los cambios de persistencia con las pruebas afectadas e integración
PostgreSQL cuando corresponda. Seguir `AGENTS.md` para typecheck, inventario,
despliegue y commit cuando el ticket cambie código o comportamiento del bot.
