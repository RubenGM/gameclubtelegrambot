# Notas complementarias de Telegram Bot API

Estas ampliaciones locales se conservan separadas de la skill externa.
Son una referencia de las funciones recogidas en la adaptación previa, no una
lista de capacidades activadas en Game Club ni una garantía de compatibilidad
actual. Consultar esta referencia sólo si el ticket afecta a estas funciones.

Antes de implementar un campo o método, contrastar su disponibilidad, parámetros,
permisos y límites con la [Bot API oficial](https://core.telegram.org/bots/api)
y el [changelog](https://core.telegram.org/bots/api-changelog), además de los tipos
de la versión instalada de grammY. La numeración de versiones de las notas es
la del material conservado; no se usa para decidir qué admite hoy Telegram.

Los ejemplos heredados usan Telegraf. Adaptar las llamadas y contextos a grammY
siguiendo el código existente; no añadir Telegraf ni otro servidor para usarlos.
Si una función requiere un flujo nuevo, implementarlo sólo cuando lo solicite
el ticket. Para progreso, borradores y topics del bot, prevalecen las guías del
repositorio enlazadas desde la skill principal.

## Recent Bot API Features

Check these Bot API additions against current official documentation when
designing new bots or updating older code:

- Bot API 9.6: managed bots, `request_managed_bot`, `managed_bot` updates,
  `managed_bot_created` messages, `getManagedBotToken`,
  `replaceManagedBotToken`, and `savePreparedKeyboardButton`
- Bot API 9.6: richer polls with `correct_option_ids`,
  `allows_multiple_answers` in quizzes, `allows_revoting`, `shuffle_options`,
  `allow_adding_options`, `hide_results_until_closes`, and poll descriptions
- Bot API 9.5: `date_time` entities, `sendMessageDraft`, member tags via
  `setChatMemberTag`, and `can_manage_tags`
- Bot API 9.4: button `style`, `icon_custom_emoji_id`, private-chat topics via
  `createForumTopic`, `allows_users_to_create_topics`, bot profile photo
  methods, and user profile audio access

Prefer raw `callApi` or raw `reply_markup` objects whenever the SDK wrappers
lag behind the Bot API.

### Button Style and Icons

Bot API 9.4 added `style` and `icon_custom_emoji_id` to both `KeyboardButton`
and `InlineKeyboardButton`.

- `style` can be `primary` (blue), `success` (green), or `danger` (red)
- if `style` is omitted, Telegram uses the client default
- `icon_custom_emoji_id` lets the button show a custom emoji when the bot can
  use custom emoji in that message
- the behavioral button field still has to be unique: only one field like
  `callback_data`, `url`, `request_contact`, `request_chat`, etc. should be
  set in addition to `text`, `icon_custom_emoji_id`, and `style`

High-level SDK helpers may lag behind the Bot API. If `Markup.button.*` or the
library type definitions don't expose `style` yet, send raw `reply_markup`
objects instead of assuming the feature is unavailable.

```javascript
await ctx.reply('Pick an action:', {
  reply_markup: {
    inline_keyboard: [[
      {
        text: 'Approve',
        callback_data: 'approve',
        style: 'success',
      },
      {
        text: 'Delete',
        callback_data: 'delete',
        style: 'danger',
      },
      {
        text: 'Docs',
        url: 'https://core.telegram.org/bots/api',
        style: 'primary',
      },
    ]],
  },
});
```

```javascript
await ctx.reply('Share what you need:', {
  reply_markup: {
    keyboard: [[
      {
        text: 'Send Contact',
        request_contact: true,
        style: 'primary',
      },
      {
        text: 'Choose Chat',
        request_chat: {
          request_id: 1,
          chat_is_channel: false,
        },
        style: 'success',
      },
    ]],
    resize_keyboard: true,
  },
});
```

### Managed Bots and Prepared Buttons

Bot API 9.6 added managed bots. Use these features when your bot creates or
operates child bots for a user, such as per-workspace support bots or branded
assistant bots.

- gate the flow on `getMe().can_manage_bots` before showing creation UI
- use reply keyboard buttons with `request_managed_bot` to let a user create a
  managed bot
- handle both `update.managed_bot` and `message.managed_bot_created`
- fetch or rotate tokens with `getManagedBotToken` and
  `replaceManagedBotToken`
- Mini Apps can persist request buttons with `savePreparedKeyboardButton`; the
  saved button must be `request_users`, `request_chat`, or
  `request_managed_bot`

```javascript
await ctx.reply('Create a managed bot for this workspace:', {
  reply_markup: {
    keyboard: [[
      {
        text: 'Create Support Bot',
        request_managed_bot: {
          request_id: 1,
          suggested_name: 'Acme Support',
          suggested_username: 'acme_support_bot',
        },
        style: 'primary',
      },
    ]],
    resize_keyboard: true,
  },
});
```

```javascript
bot.on('message', async (ctx, next) => {
  if (ctx.message.managed_bot_created) {
    const managedBotUserId = ctx.message.managed_bot_created.bot.id;
    const token = await ctx.telegram.callApi('getManagedBotToken', {
      user_id: managedBotUserId,
    });

    await saveManagedBotToken(ctx.from.id, managedBotUserId, token);
    await ctx.reply('Managed bot created and linked.');
    return;
  }

  return next();
});
```

### Modern Polls and Quizzes

Poll support is broader than older examples suggest.

- use `correct_option_ids`, not the old singular `correct_option_id`
- quizzes can now allow multiple correct answers
- polls support `allows_revoting`, `shuffle_options`, `allow_adding_options`,
  `hide_results_until_closes`, and `description`
- poll timers can stay open much longer than older defaults suggested
- if you automate poll replies, newer updates include poll-option identifiers

```javascript
await ctx.telegram.callApi('sendPoll', {
  chat_id: ctx.chat.id,
  question: 'Which admin features should ship next?',
  options: [
    { text: 'Member tags' },
    { text: 'Managed bots' },
    { text: 'Draft streaming' },
  ],
  type: 'regular',
  allows_multiple_answers: true,
  allows_revoting: true,
  shuffle_options: true,
  allow_adding_options: true,
  description: 'Vote on the next release scope.',
});
```

For quiz bots, use `correct_option_ids` as an array even when there is only one
correct answer.

### Topics, Tags, and Progressive Replies

Modern Telegram bots can behave more like operators inside chats instead of only
answering commands.

- `createForumTopic` now works for forum supergroups and private chats with
  topic mode enabled
- check `getMe().allows_users_to_create_topics` before assuming users can open
  or delete private-chat topics themselves
- admin and community bots can label members with `setChatMemberTag`, but they
  need the `can_manage_tags` admin right
- `sendMessageDraft` is for private-chat draft streaming; use it for partial
  text instead of only `sendChatAction`

```javascript
const topic = await ctx.telegram.callApi('createForumTopic', {
  chat_id: ctx.chat.id,
  name: 'Refund Case #1042',
});

await ctx.reply(`Opened topic ${topic.name}.`);
```

```javascript
const draftId = Date.now();

await ctx.telegram.callApi('sendMessageDraft', {
  chat_id: ctx.chat.id,
  draft_id: draftId,
  text: 'Analyzing your request...',
});
```

### Bot Identity and Profile Media

Bot API 9.4 also made bot identity management richer.

- use `setMyProfilePhoto` and `removeMyProfilePhoto` for seasonal branding,
  tenant-specific setup flows, or support handoffs
- `getUserProfileAudios` can help music, creator, or fan-community bots inspect
  a user's public profile audio list when that feature matters to the product

Treat these as product-level features, not just admin conveniences.

### Update Filtering and Webhook Hardening

- use `allowed_updates` to subscribe only to the update types you actually
  handle
- explicitly include newer update types like `managed_bot`, `chat_member`, or
  `message_reaction` when your bot depends on them
- protect webhooks with `secret_token` and verify the
  `X-Telegram-Bot-Api-Secret-Token` header on every request
- use `drop_pending_updates` deliberately during migrations or deploy resets,
  not as a default habit
- track whether you need `max_connections` tuning before raising it

### No Webhook Secret Verification

Severity: HIGH

Message: Webhook accepts requests without validating `secret_token`.

Fix action: Set `secret_token` in `setWebhook` and verify the
`X-Telegram-Bot-Api-Secret-Token` header in your web server

### No allowed_updates Filter

Severity: MEDIUM

Message: Bot subscribes to every update type even though it handles only a few.

Fix action: Set `allowed_updates` explicitly for polling or webhook setup

### Deprecated Poll API Usage

Severity: MEDIUM

Message: Poll code still uses outdated fields like `correct_option_id`.

Fix action: Move to `correct_option_ids` and review newer poll options such as
`allows_revoting`, `shuffle_options`, and `description`

### SDK Wrapper Drift

Severity: MEDIUM

Message: Code assumes the SDK exposes every current Bot API field.

Fix action: Use raw `callApi` or raw `reply_markup` for newer fields like
`style`, `request_managed_bot`, or `sendMessageDraft` when wrappers lag

### Managed Bot Flow Without Update Handling

Severity: LOW

Message: Manager bot can request managed bots but doesn't process
`managed_bot` or `managed_bot_created` updates.

Fix action: Handle both update types and persist or rotate managed bot tokens as
needed
