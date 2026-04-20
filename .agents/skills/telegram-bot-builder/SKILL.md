---
name: telegram-bot-builder
description: Expert in building Telegram bots that solve real problems - from
  simple automation to complex AI-powered bots. Covers bot architecture, the
  Telegram Bot API, inline and reply keyboards, topics, polls, business and
  managed-bot features, Mini App handoffs, monetization strategies, and
  scaling bots to thousands of users.
risk: unknown
source: vibeship-spawner-skills (Apache 2.0)
date_added: 2026-02-27
---

# Telegram Bot Builder

Expert in building Telegram bots that solve real problems - from simple
automation to complex AI-powered bots. Covers bot architecture, the Telegram
Bot API, inline and reply keyboards, topics, polls, business and managed-bot
features, Mini App handoffs, user experience, monetization strategies, and
scaling bots to thousands of users.

**Role**: Telegram Bot Architect

You build bots that people actually use daily. You understand that bots
should feel like helpful assistants, not clunky interfaces. You know
the Telegram ecosystem deeply - what's possible, what's popular, and
what makes money. You design conversations that feel natural.

### Expertise

- Telegram Bot API
- Bot UX design
- Monetization
- Node.js/Python bots
- Webhook architecture
- Inline keyboards

## Capabilities

- Telegram Bot API
- Bot architecture
- Command design
- Inline keyboards
- Reply keyboards
- Topics and forum flows
- Polls and quizzes
- Business and managed bots
- Mini App handoffs
- Bot monetization
- User onboarding
- Bot analytics
- Webhook management

## Recent Bot API Features

Account for these current Bot API additions when designing new bots or updating
older code:

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

## Patterns

### Bot Architecture

Structure for maintainable Telegram bots

**When to use**: When starting a new bot project

## Bot Architecture

### Stack Options
| Language | Library | Best For |
|----------|---------|----------|
| Node.js | telegraf | Most projects |
| Node.js | grammY | TypeScript, modern |
| Python | python-telegram-bot | Quick prototypes |
| Python | aiogram | Async, scalable |

### Basic Telegraf Setup
```javascript
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Command handlers
bot.start((ctx) => ctx.reply('Welcome!'));
bot.help((ctx) => ctx.reply('How can I help?'));

// Text handler
bot.on('text', (ctx) => {
  ctx.reply(`You said: ${ctx.message.text}`);
});

// Launch
bot.launch();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
```

### Project Structure
```
telegram-bot/
├── src/
│   ├── bot.js           # Bot initialization
│   ├── commands/        # Command handlers
│   │   ├── start.js
│   │   ├── help.js
│   │   └── settings.js
│   ├── handlers/        # Message handlers
│   ├── keyboards/       # Inline keyboards
│   ├── middleware/      # Auth, logging
│   └── services/        # Business logic
├── .env
└── package.json
```

### Inline Keyboards

Interactive button interfaces

**When to use**: When building interactive bot flows

## Inline Keyboards

### Basic Keyboard
```javascript
import { Markup } from 'telegraf';

bot.command('menu', (ctx) => {
  ctx.reply('Choose an option:', Markup.inlineKeyboard([
    [Markup.button.callback('Option 1', 'opt_1')],
    [Markup.button.callback('Option 2', 'opt_2')],
    [
      Markup.button.callback('Yes', 'yes'),
      Markup.button.callback('No', 'no'),
    ],
  ]));
});

// Handle button clicks
bot.action('opt_1', (ctx) => {
  ctx.answerCbQuery('You chose Option 1');
  ctx.editMessageText('You selected Option 1');
});
```

### Keyboard Patterns
| Pattern | Use Case |
|---------|----------|
| Single column | Simple menus |
| Multi column | Yes/No, pagination |
| Grid | Category selection |
| URL buttons | Links, payments |

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

### Pagination
```javascript
function getPaginatedKeyboard(items, page, perPage = 5) {
  const start = page * perPage;
  const pageItems = items.slice(start, start + perPage);

  const buttons = pageItems.map(item =>
    [Markup.button.callback(item.name, `item_${item.id}`)]
  );

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️', `page_${page-1}`));
  if (start + perPage < items.length) nav.push(Markup.button.callback('▶️', `page_${page+1}`));

  return Markup.inlineKeyboard([...buttons, nav]);
}
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

### Bot Monetization

Making money from Telegram bots

**When to use**: When planning bot revenue

## Bot Monetization

### Revenue Models
| Model | Example | Complexity |
|-------|---------|------------|
| Freemium | Free basic, paid premium | Medium |
| Subscription | Monthly access | Medium |
| Per-use | Pay per action | Low |
| Ads | Sponsored messages | Low |
| Affiliate | Product recommendations | Low |

### Telegram Payments
```javascript
// Create invoice
bot.command('buy', (ctx) => {
  ctx.replyWithInvoice({
    title: 'Premium Access',
    description: 'Unlock all features',
    payload: 'premium_monthly',
    provider_token: process.env.PAYMENT_TOKEN,
    currency: 'USD',
    prices: [{ label: 'Premium', amount: 999 }], // $9.99
  });
});

// Handle successful payment
bot.on('successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  // Activate premium for user
  await activatePremium(ctx.from.id);
  ctx.reply('🎉 Premium activated!');
});
```

### Freemium Strategy
```
Free tier:
- 10 uses per day
- Basic features
- Ads shown

Premium ($5/month):
- Unlimited uses
- Advanced features
- No ads
- Priority support
```

### Usage Limits
```javascript
async function checkUsage(userId) {
  const usage = await getUsage(userId);
  const isPremium = await checkPremium(userId);

  if (!isPremium && usage >= 10) {
    return { allowed: false, message: 'Daily limit reached. Upgrade?' };
  }
  return { allowed: true };
}
```

### Webhook Deployment

Production bot deployment

**When to use**: When deploying bot to production

## Webhook Deployment

### Polling vs Webhooks
| Method | Best For |
|--------|----------|
| Polling | Development, simple bots |
| Webhooks | Production, scalable |

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

### Express + Webhook
```javascript
import express from 'express';
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const WEBHOOK_PATH = '/webhook';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const WEBHOOK_URL = `https://your-domain.com${WEBHOOK_PATH}`;

app.use(express.json());
app.use(WEBHOOK_PATH, (req, res, next) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET) {
    res.sendStatus(401);
    return;
  }

  return next();
});
app.use(bot.webhookCallback(WEBHOOK_PATH));

// Set webhook
bot.telegram.setWebhook(WEBHOOK_URL, {
  secret_token: WEBHOOK_SECRET,
  allowed_updates: [
    'message',
    'callback_query',
    'chat_member',
    'managed_bot',
  ],
});

app.listen(3000);
```

### Vercel Deployment
```javascript
// api/webhook.js
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);
// ... bot setup

export default async (req, res) => {
  await bot.handleUpdate(req.body);
  res.status(200).send('OK');
};
```

### Railway/Render Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "src/bot.js"]
```

## Validation Checks

### Bot Token Hardcoded

Severity: HIGH

Message: Bot token appears to be hardcoded - security risk!

Fix action: Move token to environment variable BOT_TOKEN

### No Bot Error Handler

Severity: HIGH

Message: No global error handler for bot.

Fix action: Add bot.catch() to handle errors gracefully

### No Webhook Secret Verification

Severity: HIGH

Message: Webhook accepts requests without validating `secret_token`.

Fix action: Set `secret_token` in `setWebhook` and verify the
`X-Telegram-Bot-Api-Secret-Token` header in your web server

### No allowed_updates Filter

Severity: MEDIUM

Message: Bot subscribes to every update type even though it handles only a few.

Fix action: Set `allowed_updates` explicitly for polling or webhook setup

### No Rate Limiting

Severity: MEDIUM

Message: No rate limiting - may hit Telegram limits.

Fix action: Add throttling with Bottleneck or similar library

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

### In-Memory Sessions in Production

Severity: MEDIUM

Message: Using in-memory sessions - will lose state on restart.

Fix action: Use Redis or database-backed session store for production

### No Typing Indicator

Severity: LOW

Message: Consider adding typing indicator for better UX.

Fix action: Add ctx.sendChatAction('typing') before slow operations

### Managed Bot Flow Without Update Handling

Severity: LOW

Message: Manager bot can request managed bots but doesn't process
`managed_bot` or `managed_bot_created` updates.

Fix action: Handle both update types and persist or rotate managed bot tokens as
needed

## Collaboration

### Delegation Triggers

- mini app|web app|TON|twa -> telegram-mini-app (Mini App integration)
- AI|GPT|Claude|LLM|chatbot -> ai-wrapper-product (AI integration)
- database|postgres|redis -> backend (Data persistence)
- payments|subscription|billing -> fintech-integration (Payment integration)
- deploy|host|production -> devops (Deployment)

### AI Telegram Bot

Skills: telegram-bot-builder, ai-wrapper-product, backend

Workflow:

```
1. Design bot conversation flow
2. Set up AI integration (OpenAI/Claude)
3. Build backend for state/data
4. Implement bot commands and handlers
5. Add monetization (freemium)
6. Deploy and monitor
```

### Bot + Mini App

Skills: telegram-bot-builder, telegram-mini-app, frontend

Workflow:

```
1. Design bot as entry point
2. Build Mini App for complex UI
3. Integrate bot commands with Mini App
4. Handle payments in Mini App
5. Deploy both components
```

## Related Skills

Works well with: `telegram-mini-app`, `backend`, `ai-wrapper-product`, `workflow-automation`

## When to Use
- User mentions or implies: telegram bot
- User mentions or implies: bot api
- User mentions or implies: telegram automation
- User mentions or implies: chat bot telegram
- User mentions or implies: tg bot

## Limitations
- Use this skill only when the task clearly matches the scope described above.
- Do not treat the output as a substitute for environment-specific validation, testing, or expert review.
- Stop and ask for clarification if required inputs, permissions, safety boundaries, or success criteria are missing.
