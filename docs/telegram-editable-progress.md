# Mensajes de progreso editables en Telegram

Usa `src/telegram/editable-progress.ts` cuando una acción media o lenta necesite
un único mensaje de estado que se actualice, en vez de enviar un mensaje nuevo
en cada paso.

No todos los procesos largos pueden publicar progreso en el chat de origen. La
excepción más importante son las menciones LLM en grupos/topics: se ejecutan
silenciosamente y nunca deben crear progreso público; si se interpretan bien, el
resultado se entrega por privado.

## Helper

Inicia un mensaje editable:

```ts
const progress = await startTelegramEditableProgress(context, initialText, {
  editFailedEvent: 'module.flow.progress-edit.failed',
});

await progress.update(nextText);
await progress.complete(finalText, finalOptions);
```

Reanuda un recibo o progreso cuyo ID esté guardado en la sesión:

```ts
const progress = resumeTelegramEditableProgress(context, receiptMessageId, {
  editFailedEvent: 'module.flow.receipt-edit.failed',
});

if (!(await progress.update(nextText))) {
  const fallback = await startTelegramEditableProgress(context, nextText, {
    editFailedEvent: 'module.flow.receipt-edit.failed',
  });
  receiptMessageId = fallback.messageId ?? receiptMessageId;
}
```

`update(...)` devuelve `true` si Telegram aceptó la edición. El error
`message is not modified` también cuenta como éxito/no-op: no desactiva las
ediciones posteriores. Cualquier otro fallo desactiva nuevas ediciones para esa
instancia, emite el warning JSON indicado por `editFailedEvent` y devuelve
`false`.

`complete(...)` edita cuando puede y, si no, envía el resultado final mediante
`context.reply(...)`. Un fallo de edición no debe convertir una operación de
negocio correcta en un error para el usuario.

La frontera común de Telegram sanea también estos textos antes de enviarlos.
Los mensajes nuevos que superan el límite se dividen, pero una edición no puede
crear fragmentos adicionales: `editMessageText` conserva HTML válido y acota el
contenido con una elipsis. El fallback de `complete(...)` vuelve a pasar por
`context.reply(...)` y sí puede dividir el resultado completo.

## Teclados de respuesta

Telegram `editMessageText` no puede adjuntar un reply keyboard normal. No crees
un recibo o progreso editable con `replyKeyboard` si después habrá que editar
ese mismo mensaje.

Separa los mensajes:

- Envía los controles con `replyKeyboard` cuando el usuario necesite botones
  como `Terminar adjuntos`, `Añadir a almacenamiento` o `/cancel`.
- Envía el recibo/progreso editable sin `replyKeyboard`.
- No pases `replyKeyboard` al editar el recibo.
- Usa inline keyboard sólo cuando el propio mensaje editable necesite acciones
  inline y el flujo haya sido diseñado para ello.

Si el mensaje original tenía reply keyboard, Telegram puede devolver
`400: Bad Request: message can't be edited`. Crea entonces un recibo editable
nuevo sin ese teclado y guarda su nuevo `messageId`.

## Patrón de sesión

Para flujos con muchas actualizaciones, guarda el ID del recibo en la sesión:

```ts
data: {
  ...session.data,
  messages,
  ...(receiptMessageId ? { receiptMessageId } : {}),
}
```

Usa un nombre específico del flujo, como `uploadReceiptMessageId` o
`forwardedReceiptMessageId`, para no sobrescribir progresos no relacionados.

## Referencias actuales

Además de Storage, el helper se usa en el intérprete LLM privado, `/adminai`,
modelos IA, generación de imágenes, Google Calendar, Notion, materiales de Rol,
eventos del local y operaciones de catálogo. Cada consumidor debe aportar un
`editFailedEvent` estable y estructurado.

La presencia del helper no sustituye el diseño del progreso: el texto debe
mostrar pasos concretos, no exponer secretos ni la petición completa y terminar
en un resultado accionable.

## Tests

Cubre como mínimo:

- envío inicial y extracción de `messageId`;
- actualizaciones posteriores sobre el mismo mensaje;
- ausencia de `replyKeyboard` en las ediciones;
- `message is not modified` como éxito sin warning;
- warning estructurado y fallback tras otro fallo de edición;
- creación y persistencia de un `messageId` de sustitución;
- ausencia total de progreso público para menciones LLM de grupo/topic.

Referencias:

- `src/telegram/editable-progress.test.ts`
- `src/telegram/storage-flow.test.ts`
- `src/telegram/llm-command-flow.test.ts`
