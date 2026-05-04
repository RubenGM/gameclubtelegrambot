# Telegram Button Legibility Design

## Goal

Mejorar la legibilidad de todos los botones del bot de Telegram sin depender de meter emoji dentro del texto del boton.

La UX objetivo es:

- mantener textos de boton claros y autosuficientes
- aprovechar `style` e `icon_custom_emoji_id` de Bot API cuando el cliente los soporte
- configurar la apariencia visual de forma global por rol semantico, no boton por boton
- aplicar el mismo criterio a `reply keyboard` e `inline keyboard`

## Scope

La v1 cubre solo:

- soporte de `style` e `icon_custom_emoji_id` en el `reply_markup` raw que envia el bot
- nuevo modelo interno de apariencia visual por rol semantico de boton
- configuracion runtime opcional para esa apariencia global
- migracion de los builders de botones del bot a botones tipados con rol semantico
- tests de conversion a Telegram, schema de config y builders clave

La v1 no cubre:

- meter emoji directamente en el texto del boton
- configuracion individual por boton concreto
- deteccion automatica del rol semantico a partir del texto localizado
- cambios grandes de copy en i18n mas alla de los ajustes minimos necesarios de legibilidad
- dependencia funcional de los iconos: el boton debe seguir siendo entendible sin ellos

## Current Project Context

El proyecto ya tiene una frontera clara para la salida Telegram:

- `src/telegram/runtime-boundary-support.ts` define `TelegramReplyOptions` y los tipos de botones inline actuales
- `src/telegram/runtime-boundary-registration.ts` convierte esas opciones al `reply_markup` raw que consume grammY
- muchos flujos en `src/telegram/*.ts` construyen `replyKeyboard` como `string[][]`
- los botones inline ya usan un pequeno objeto con `text`, `callbackData` y `url`

Tambien hay dos restricciones reales del codigo actual:

- `replyKeyboard` no puede llevar hoy metadatos visuales porque solo modela texto plano
- no existe una capa comun para expresar semantica visual como `primary`, `danger` o `help`

La skill de Telegram recomienda enviar `reply_markup` raw cuando el SDK va por detras del Bot API. Ese patron ya encaja con la implementacion actual del proyecto y evita depender de wrappers incompletos.

## Approaches Considered

### 1. Ajuste local en `toGrammyReplyOptions` y unos pocos teclados

Ventaja: cambio pequeno en apariencia.

Inconveniente: no resuelve `reply keyboard`, porque hoy solo hay strings y no existe donde guardar `style` ni `icon_custom_emoji_id`.

### 2. Modelo unificado de boton con rol semantico y decoracion global

Ventaja: cubre `reply` e `inline`, centraliza la legibilidad visual y evita repetir IDs o estilos por cada boton.

Inconveniente: obliga a migrar builders y tests en varios modulos Telegram.

### 3. Decoracion heuristica al final segun el texto del boton

Ventaja: tocaria menos builders.

Inconveniente: es fragil por idioma, dificil de mantener y propenso a errores cuando cambie la copia.

La opcion recomendada es la 2.

## Recommended Architecture

### 1. Semantic Button Model

Se recomienda introducir un modelo comun de boton Telegram con dos ideas separadas:

- comportamiento del boton
- apariencia visual opcional derivada de un rol semantico

Tipos orientativos:

- `TelegramButtonSemanticRole = 'primary' | 'secondary' | 'success' | 'danger' | 'navigation' | 'help'`
- `TelegramButtonAppearance = { style?: 'primary' | 'success' | 'danger'; iconCustomEmojiId?: string }`

Para botones de `reply keyboard`:

- nuevo tipo `TelegramReplyButton` con `text` y `semanticRole?`

Para botones `inline`:

- extender `TelegramInlineButton` para incluir `semanticRole?`
- mantener `callbackData` o `url` como hasta ahora

El rol semantico no cambia el significado funcional del boton. Solo decide como se decora visualmente si hay configuracion disponible.

### 2. Reply Options Contract

`TelegramReplyOptions` debe dejar de modelar `replyKeyboard` como `string[][]` y pasar a una matriz de botones tipados.

Contrato orientativo:

- `replyKeyboard?: TelegramReplyButton[][]`
- `inlineKeyboard?: TelegramInlineButton[][]`

La capa Telegram del proyecto quedara asi alineada: tanto `reply` como `inline` comparten el mismo concepto de boton visible con rol semantico.

### 3. Global Appearance Configuration

La configuracion runtime debe anadir una nueva seccion JSON opcional bajo `telegram`:

- `telegram.buttonAppearance`

Shape recomendada:

- `telegram.buttonAppearance.primary`
- `telegram.buttonAppearance.secondary`
- `telegram.buttonAppearance.success`
- `telegram.buttonAppearance.danger`
- `telegram.buttonAppearance.navigation`
- `telegram.buttonAppearance.help`

Cada entrada de rol acepta:

- `style?: 'primary' | 'success' | 'danger'`
- `iconCustomEmojiId?: string`

Ejemplo orientativo:

```json
{
  "telegram": {
    "buttonAppearance": {
      "primary": { "style": "primary", "iconCustomEmojiId": "5393123412341234123" },
      "success": { "style": "success" },
      "danger": { "style": "danger" },
      "navigation": { "iconCustomEmojiId": "5393123412341234999" },
      "help": { "iconCustomEmojiId": "5393123412341234888" }
    }
  }
}
```

La configuracion debe ser opcional y por rol conocido. No se admiten roles libres definidos por usuario en esta v1.

### 4. Appearance Resolver

Se recomienda una funcion pequena y aislada que reciba:

- el boton concreto
- la configuracion global de apariencia

Y devuelva el payload raw listo para Telegram con:

- `text`
- `callback_data` o `url` si aplica
- `style` si el rol lo resuelve y el rol tiene estilo configurado
- `icon_custom_emoji_id` si el rol lo resuelve y hay ID configurado

Esta resolucion debe ocurrir en `toGrammyReplyOptions`, no repartida por cada builder. Los builders solo expresan intencion semantica.

### 5. Builder Migration Strategy

Los builders de `src/telegram/*.ts` deben migrarse de forma mecanica a botones tipados.

Criterio inicial de asignacion:

- acciones principales de entrada a seccion o confirmacion fuerte: `primary`
- acciones afirmativas o de aprobacion: `success`
- cancelaciones destructivas, rechazos o borrados: `danger`
- volver, inicio, atras, cambiar de pantalla: `navigation`
- ayuda y soporte: `help`
- acciones neutras de lista o seleccion simple: `secondary`

La asignacion debe ser pequena y consistente. No hace falta una taxonomia mas grande en la v1.

## Data Flow

### Flow 1: Reply Keyboard

1. Un builder crea `replyKeyboard` con botones tipados y `semanticRole` opcional.
2. `toGrammyReplyOptions` recorre la matriz.
3. Cada boton se resuelve contra `config.telegram.buttonAppearance`.
4. Se genera `reply_markup.keyboard` con `text` y, cuando aplique, `style` e `icon_custom_emoji_id`.
5. Telegram renderiza la decoracion si el cliente la soporta.

### Flow 2: Inline Keyboard

1. Un builder crea botones inline con `text`, accion y `semanticRole` opcional.
2. `toGrammyReplyOptions` resuelve la apariencia del mismo modo.
3. Se genera `reply_markup.inline_keyboard` con `callback_data` o `url` y decoracion visual opcional.
4. El callback y el comportamiento funcional no cambian.

## Error Handling

- Si `buttonAppearance` no existe, el bot debe seguir enviando botones solo con `text`.
- Si un rol concreto no tiene configuracion, solo ese rol queda sin decoracion; no debe fallar todo el mensaje.
- Si `iconCustomEmojiId` es cadena vacia o invalida segun schema, la configuracion debe rechazarse al cargar runtime config.
- Si el cliente Telegram no soporta o ignora `style` o `icon_custom_emoji_id`, el boton debe seguir siendo usable porque el texto sigue siendo autosuficiente.
- Si grammY no expone tipos actualizados para estos campos, la frontera debe seguir usando payload raw como hace hoy.

## Testing

La implementacion debe seguir TDD y cubrir, como minimo:

### 1. Raw Markup Conversion

Tests para `toGrammyReplyOptions` que verifiquen:

- `reply keyboard` con `style`
- `reply keyboard` con `icon_custom_emoji_id`
- `inline keyboard` con `style`
- `inline keyboard` con `icon_custom_emoji_id`
- ausencia de decoracion cuando no hay `semanticRole`
- ausencia de decoracion cuando no hay config para el rol

### 2. Runtime Config Schema

Tests de `runtime-config` para verificar:

- aceptacion de `buttonAppearance` opcional
- rechazo de `style` invalido
- rechazo de `iconCustomEmojiId` vacio
- rechazo de claves de rol desconocidas

### 3. Builder Semantics

Tests en modulos clave para verificar la semantica asignada, al menos en:

- menu principal (`action-menu`)
- acciones de ayuda y navegacion
- acciones de cancelacion
- acciones inline afirmativas y destructivas ya existentes

No hace falta testear la UI del cliente Telegram. El contrato importante es el payload raw que enviamos.

## Acceptance Criteria

- `reply keyboard` e `inline keyboard` pueden incluir `style` e `icon_custom_emoji_id`.
- la apariencia visual se configura globalmente por rol semantico en runtime config.
- el proyecto no necesita poner emoji en el texto para usar iconos de boton.
- los botones siguen funcionando cuando no hay configuracion visual.
- el menu principal y los flujos Telegram relevantes usan roles semanticos consistentes.
- la suite de tests cubre conversion, config y asignacion semantica basica.

## Implementation Notes

- El cambio debe mantenerse pequeno: una sola capa de resolucion visual, sin heuristicas por texto y sin configuracion por boton concreto.
- La migracion debe preservar el copy existente salvo donde haya un ajuste pequeno de claridad ya justificado por legibilidad.
- No se debe introducir dependencia funcional de la decoracion visual. El texto sigue siendo la fuente primaria de comprension.
