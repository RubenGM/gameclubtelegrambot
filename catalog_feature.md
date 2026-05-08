# Plan de implementación — Feature **Añadir múltiples** (Catálogo)

## Objetivo
Permitir a administrador/a añadir varios ítems del catálogo en un solo flujo conversacional, manteniendo la misma experiencia de selección de tipo que el flujo actual de **Añadir uno**.

## Requisitos funcionales (obligatorios)
1. El flujo debe iniciar pidiendo la categoría (juegos de mesa / libros / resto de tipos permitidos) de la misma forma que “Añadir uno”.
2. El usuario escribe una lista de nombres en un único mensaje separados por coma `,` (se permite espacio después de la coma).
3. Tras recibir la lista, el bot agradece y deja claro que el proceso continúa **en background**.
4. El procesamiento de ítems debe hacerse **uno a uno** para no saturar API externas.
5. Si la coincidencia es suficientemente clara, se crea el ítem automáticamente y se añade al catálogo del club.
6. Al terminar, se envía un resumen con:
   - Ítems añadidos
   - Ítems ya existentes / duplicados
   - Ítems sin coincidencia clara (con recomendación de proceso manual)
   - Ítems con error
7. El resumen debe explicitar qué hacer si quedaron pendientes manuales: “si quieres, repítelos uno a uno”.

## UX / mensajes
- **Mensaje de inicio (tras pulsar botón o comando):** seleccionar tipo de catálogo, igual que el flujo actual de alta simple.
- **Mensaje de recepción de lista:** “Envíame los títulos separados por coma.”
- **Mensaje de ack inmediatamente después de la lista:**  
  `✅ Gracias. Voy a procesar tu solicitud en background para no bloquear. Te paso un resumen cuando termine.`
- **Mensaje final en resumen (preferiblemente privado):** desglosado por estado con emojis o prefijos:
  - `✅ Añadidos`
  - `⚠️ Ya existentes`
  - `❓ Sin coincidencia clara / revisar manualmente`
  - `❌ Errores`
- Si falla el envío privado, notificar de forma transparente en el chat de control y ofrecer envío de resumen visible.

## Definición de “coincidencia clara” (regla mínima)
Un candidato se considera claro si existe:
1. coincidencia exacta normalizada por nombre en catálogo activo, o
2. una sola coincidencia fuerte tras búsqueda/external service para ese tipo.

Ambigüedad o múltiples resultados => no auto-aceptar; pasar a “manual”.

## Diseño técnico del flow

### Estados de sesión
1. `bulk-item-type`: elegir tipo (mismo catálogo/labels que añadir uno).
2. `bulk-item-names`: recibir texto con lista.
3. Tras validar lista, disparar job asíncrono y cerrar sesión.

### Flujo en background
- Procesamiento secuencial `for` con `await` por item.
- Pausa entre items (`~700ms` como base inicial, configurable) para no saturar API externa.
- Manejo de errores por item: un fallo no aborta el lote.
- Tolerancia a interrupciones: no hay dependencia en el thread de conversación.

## Estructura de código sugerida (ficheros concretos)
1. `src/telegram/catalog-admin-keyboards.ts`
   - Añadir acción/botón `bulkCreate` junto a “Añadir uno”.
2. `src/telegram/catalog-admin-support.ts`
   - Gestionar nueva acción de texto `bulkCreate` en `handleTelegramCatalogAdminText`.
   - Añadir `bulk-item-type` y `bulk-item-names`.
   - Implementar `runCatalogBulkCreateJob`:
     - recorre secuencialmente
     - aplica resolución/creación
     - recolecta resultados
     - envía resumen final
   - Añadir helper de pausa (`sleepMs`) si no existe.
3. `src/telegram/i18n-catalog-admin.ts`
   - Añadir textos ES/CAT/EN para:
     - label de botón bulk
     - prompt de lista
     - ack background
     - resumen final y errores de privacidad/fallo.
4. `src/telegram/catalog-admin-parsing.ts` (o helper en `catalog-admin-support.ts` si se prefiere)
   - Parser de cadena separada por coma:
     - `split(',')`
     - `trim()`
     - descartar vacíos
     - normalizar espacios dobles internos
     - respetar orden original
     - límite de lote (e.g. 100)
5. `src/telegram/runtime-boundary-registration.ts`
   - Registrar comando opcional `/catalog_bulk` (si no existe).
6. `src/telegram/catalog-admin-flow.ts` / `src/telegram/telegram-flow-state.ts` (si aplica)
   - Exponer el nuevo flow en el registro de flujos.
7. `src/telegram/catalog-admin-flow.test.ts`
   - Actualizar asserts de menú si el botón ya existe.
   - Cobertura de:
     - ruta tipo → lista
     - ack inmediato
     - finalización de resumen en background.
8. `src/telegram/catalog-admin-parsing.test.ts` o test equivalente
   - tests del parser de coma y límites.

## Reglas de persistencia y seguridad
- Reutilizar los repositorios de catálogo ya existentes para crear entradas.
- Mantener autorización y permisos del flujo actual (solo admins habilitados).
- Registrar auditoría para cada auto-alta (si el sistema la usa).
- Evitar exponer IDs internos o slugs al usuario en mensajes de resumen.

## Resultado esperado por item
Para cada entrada de la lista guardar un estado interno:
- `added` con nombre normalizado y `itemId`
- `already_exists`
- `ambiguous`
- `not_found`
- `error` (+ mensaje corto de causa)

El resumen final debe mantener el mismo orden de entrada.

## Observabilidad
- Log por item (chatId de operador, tipo, nombre original, estado final).
- Métricas de lote:
  - total
  - añadidos
  - duplicados
  - sin match
  - ambiguos
  - errores
- Marcar explícitamente cuando el job termina y cuándo se envía el resumen.

## Checklist de aceptación
1. Desde menú, “Añadir múltiples” pide tipo igual que “Añadir uno”.
2. Introducción de lista por comas reconoce varios nombres y respeta comas con espacios.
3. ACK de background llega de inmediato (no espera importación completa).
4. API externa no se llama en paralelo para este flujo.
5. Ítems con coincidencia clara se crean correctamente.
6. Se produce resumen final completo y útil.
7. Ítems no resueltos quedan listos para alta manual y el texto lo indica.
8. `./startup.sh` y prueba manual de Telegram confirman experiencia sin regresiones.
