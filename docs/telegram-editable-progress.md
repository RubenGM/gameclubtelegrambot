# Telegram editable progress messages

Use `src/telegram/editable-progress.ts` when a Telegram flow needs one status
message that updates itself instead of sending a new message at every step.

## Helper

Start a new editable message with:

```ts
const progress = await startTelegramEditableProgress(context, initialText, {
  editFailedEvent: 'module.flow.progress-edit.failed',
});

await progress.update(nextText);
await progress.complete(finalText, finalOptions);
```

Resume a previously sent progress or receipt message stored in session data:

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

`update(...)` returns `true` when Telegram accepted the edit. `complete(...)`
edits when possible and falls back to `context.reply(...)` when editing is not
available.

## Reply keyboards

Telegram `editMessageText` cannot attach normal reply keyboards. Do not create
an editable receipt or progress message with `replyKeyboard` if that same
message must later be edited.

Use this split instead:

- Send control prompts with `replyKeyboard` when the user needs buttons such as
  `Terminar adjuntos`, `Añadir a almacenamiento` or `/cancel`.
- Send the editable receipt/progress message without `replyKeyboard`.
- When editing the receipt/progress message, pass no `replyKeyboard` options.
- Inline keyboards are acceptable only when the edited message really needs
  inline buttons and Telegram accepts that flow.

If a message was originally sent with a normal reply keyboard, Telegram may
return `400: Bad Request: message can't be edited`. Treat that as a signal to
create a new editable receipt without a reply keyboard and store its new
`messageId`.

## Session pattern

For flows that receive many updates, store the editable receipt id in session
data:

```ts
data: {
  ...session.data,
  messages,
  ...(receiptMessageId ? { receiptMessageId } : {}),
}
```

Keep the stored id flow-specific, for example `uploadReceiptMessageId` or
`forwardedReceiptMessageId`, so unrelated progress messages do not overwrite
each other.

## Tests

Add focused tests for:

- The first receipt being sent normally.
- Later updates editing the same `messageId`.
- Edit calls not carrying `replyKeyboard`.
- Fallback creating and storing a replacement `messageId` when editing fails.

Existing reference tests live in:

- `src/telegram/editable-progress.test.ts`
- `src/telegram/storage-flow.test.ts`
