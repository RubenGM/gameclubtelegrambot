---
name: gameclub-telegram
description: Desarrollar y revisar los flujos Telegram de Game Club con grammY, permisos, sesiones y topics. Usar al modificar handlers, teclados, mensajes, routing o integraciones IA del bot de este repositorio.
metadata:
  maintenance: project
---

# Telegram en Game Club

Contexto propio del repositorio, complementario a `telegram-bot-builder`.
Las reglas generales de trabajo y entrega viven en
[AGENTS.md](../../../AGENTS.md); consultar las guías siguientes según el cambio.

## Arquitectura y referencias

El bot usa TypeScript, grammY con `@grammyjs/runner`, PostgreSQL y systemd.
La web de apoyo es el Admin HTTP server integrado en el servicio. Los ejemplos
externos con Telegraf, Express o plataformas de despliegue ilustran patrones;
la implementación debe seguir los handlers y la persistencia actuales.

| Cambio | Referencia que hay que leer |
| --- | --- |
| Listas, navegación y paginación | [Estilo de paginación](../../../docs/telegram-pagination-style.md) |
| Progreso, recibos editables o borradores | [Progreso editable](../../../docs/telegram-editable-progress.md) |
| `/ask`, `/adminai`, prompts, intents o invocación de IA | [Lenguaje natural](../../../docs/llm-natural-language.md) |
| Comportamiento y pruebas de un módulo | [Inventario de features](../../../docs/feature-status.md) |
| Validación del cambio | [Desarrollo y validación](../../../docs/development-and-validation.md) |

Leer sólo la guía que corresponda y el flujo existente del dominio antes de
introducir un patrón nuevo. Mantener las decisiones de producto documentadas
en el inventario y en `AGENTS.md`.

## Criterios de implementación

- Conservar permisos, confirmaciones, navegación, deep links, teclados y
  equivalencia entre el mensaje enriquecido y su fallback de texto.
- Mantener la identidad del actor, chat y sesión al terminar operaciones
  asíncronas; una respuesta tardía no debe reactivar un flujo abandonado.
- Al cambiar grupos o topics, seguir las claves de suscripción y el destino
  `message_thread_id` definidos en `AGENTS.md` y en la persistencia existente.
- Usar el helper de progreso y las rutas de borradores descritos en su guía.
  Los borradores requieren un resultado duradero. Respetar la excepción de las
  menciones LLM en grupos/topics, que se procesan sin progreso público.
- Para IA, seguir la guía LLM y los wrappers configurados. Mantener las
  comprobaciones locales de permisos y confirmaciones del flujo.

## Compatibilidad con Telegram

Comprobar los métodos y campos contra la Bot API oficial y los tipos de la
versión instalada de grammY antes de adoptarlos. Un wrapper que no expone un
campo no demuestra que Telegram no lo soporte; una llamada raw también necesita
validación de compatibilidad y comportamiento.

Las ampliaciones conservadas sobre botones, encuestas, topics, etiquetas,
bots gestionados, medios de perfil y webhooks están en
[Notas de Telegram Bot API](references/telegram-api-notes.md). Leer esa referencia
cuando el ticket afecte a esas funciones; no usarlas como una lista de features
pendientes que haya que implementar.
