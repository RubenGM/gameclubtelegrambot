import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectLocalBotFrustration,
  handleTelegramFeedbackSessionText,
  offerTelegramFeedbackForLocalFrustration,
  telegramFeedbackFlowKey,
} from './feedback-flow.js';
import { feedbackTexts } from './i18n-feedback.js';
import type { ConversationSessionRecord, ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';

test('detectLocalBotFrustration uses local dictionaries with accent-insensitive matching', () => {
  assert.equal(detectLocalBotFrustration('Este bot es inútil'), 'insult');
  assert.equal(detectLocalBotFrustration('Vaya desastre, no funciona nada'), 'frustration');
  assert.equal(detectLocalBotFrustration('Aquest bot és inútil'), 'insult');
  assert.equal(detectLocalBotFrustration('Això no serveix per a res'), 'frustration');
  assert.equal(detectLocalBotFrustration('This bot is useless'), 'insult');
  assert.equal(detectLocalBotFrustration("This doesn't work"), 'frustration');
  assert.equal(detectLocalBotFrustration('Quiero ver las actividades del sábado'), null);
  assert.equal(detectLocalBotFrustration('Necesito imprimir un cubo de basura para la partida'), null);
  assert.equal(detectLocalBotFrustration('Explain garbage collection in JavaScript'), null);
  assert.equal(detectLocalBotFrustration('This design is idiotproof'), null);
});

test('feedback flow asks for consent and saves accepted Telegram feedback in the shared JSONL format', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'gameclub-feedback-'));
  const feedbackFile = join(tempDirectory, 'feedback.jsonl');
  const context = createContext({ messageText: 'Este bot es inútil' });

  assert.equal(await offerTelegramFeedbackForLocalFrustration(context), true);
  assert.equal(context.session.current?.flowKey, telegramFeedbackFlowKey);
  assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.offer);

  context.messageText = feedbackTexts.es.accept;
  assert.equal(await handleTelegramFeedbackSessionText(context, { feedbackFile }), true);
  assert.equal(context.session.current?.stepKey, 'capture');
  assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.prompt);

  context.messageText = 'La edición de la mesa no se guardó y no quedó claro que había que confirmar.';
  assert.equal(await handleTelegramFeedbackSessionText(context, { feedbackFile }), true);
  assert.equal(context.session.current, null);
  assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.saved);

  const [entry] = (await readFile(feedbackFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(entry, {
    createdAt: entry?.createdAt,
    topic: 'bot-telegram-insult',
    name: '',
    contact: 'telegram:123',
    message: 'La edición de la mesa no se guardó y no quedó claro que había que confirmar.',
    userAgent: 'telegram-local-dictionary',
    remoteAddress: '',
  });

  await rm(tempDirectory, { recursive: true, force: true });
});

test('feedback flow does not save anything when the user declines', async () => {
  const context = createContext({ messageText: 'Vaya desastre, no funciona nada' });

  await offerTelegramFeedbackForLocalFrustration(context);
  context.messageText = feedbackTexts.es.decline;
  assert.equal(await handleTelegramFeedbackSessionText(context, { feedbackFile: '/unused/feedback.jsonl' }), true);

  assert.equal(context.session.current, null);
  assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.declined);
});

test('feedback detection stays private and never interrupts another active flow', async () => {
  const groupContext = createContext({ messageText: 'Este bot es inútil', chatKind: 'group' });
  assert.equal(await offerTelegramFeedbackForLocalFrustration(groupContext), false);
  assert.equal(groupContext.replies.length, 0);

  const activeFlowContext = createContext({ messageText: 'Este bot es inútil' });
  await activeFlowContext.session.start({ flowKey: 'schedule-create', stepKey: 'title' });
  assert.equal(await offerTelegramFeedbackForLocalFrustration(activeFlowContext), false);
  assert.equal(activeFlowContext.replies.length, 0);
});

test('feedback requires an approved, non-blocked actor and cancels feedback if access changes', async () => {
  const pendingContext = createContext({
    messageText: 'Este bot es inútil',
    isApproved: false,
  });
  assert.equal(await offerTelegramFeedbackForLocalFrustration(pendingContext), false);
  assert.equal(pendingContext.session.current, null);

  const blockedContext = createContext({
    messageText: 'Este bot es inútil',
    isBlocked: true,
  });
  assert.equal(await offerTelegramFeedbackForLocalFrustration(blockedContext), false);
  assert.equal(blockedContext.session.current, null);

  const revokedDuringFlow = createContext({ messageText: 'Este bot es inútil' });
  await offerTelegramFeedbackForLocalFrustration(revokedDuringFlow);
  revokedDuringFlow.runtime.actor.isApproved = false;
  revokedDuringFlow.messageText = feedbackTexts.es.accept;
  assert.equal(await handleTelegramFeedbackSessionText(revokedDuringFlow, {
    feedbackFile: '/unused/feedback.jsonl',
  }), true);
  assert.equal(revokedDuringFlow.session.current, null);
  assert.equal(revokedDuringFlow.replies.length, 1);

  const blockedDuringFlow = createContext({ messageText: 'Este bot es inútil' });
  await offerTelegramFeedbackForLocalFrustration(blockedDuringFlow);
  blockedDuringFlow.runtime.actor.isBlocked = true;
  blockedDuringFlow.messageText = feedbackTexts.es.accept;
  assert.equal(await handleTelegramFeedbackSessionText(blockedDuringFlow, {
    feedbackFile: '/unused/feedback.jsonl',
  }), true);
  assert.equal(blockedDuringFlow.session.current, null);
  assert.equal(blockedDuringFlow.replies.length, 1);
});

test('feedback accepts exact length boundaries and rejects text outside them', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'gameclub-feedback-limits-'));
  const feedbackFile = join(tempDirectory, 'feedback.jsonl');
  try {
    const minimum = createContext({ messageText: 'Este bot es inútil' });
    await advanceToCapture(minimum);
    minimum.messageText = 'abc';
    assert.equal(await handleTelegramFeedbackSessionText(minimum, { feedbackFile }), true);
    assert.equal(minimum.session.current, null);

    const maximum = createContext({ messageText: 'Este bot es inútil' });
    await advanceToCapture(maximum);
    maximum.messageText = 'x'.repeat(4_000);
    assert.equal(await handleTelegramFeedbackSessionText(maximum, { feedbackFile }), true);
    assert.equal(maximum.session.current, null);

    const tooShort = createContext({ messageText: 'Este bot es inútil' });
    await advanceToCapture(tooShort);
    tooShort.messageText = 'ab';
    assert.equal(await handleTelegramFeedbackSessionText(tooShort, { feedbackFile }), true);
    assert.equal(tooShort.session.current?.stepKey, 'capture');
    assert.equal(tooShort.replies.at(-1)?.message, feedbackTexts.es.invalid);

    const tooLong = createContext({ messageText: 'Este bot es inútil' });
    await advanceToCapture(tooLong);
    tooLong.messageText = 'x'.repeat(4_001);
    assert.equal(await handleTelegramFeedbackSessionText(tooLong, { feedbackFile }), true);
    assert.equal(tooLong.session.current?.stepKey, 'capture');
    assert.equal(tooLong.replies.at(-1)?.message, feedbackTexts.es.tooLong);

    const entries = (await readFile(feedbackFile, 'utf8')).trim().split('\n');
    assert.equal(entries.length, 2);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('feedback append failure keeps the capture session so the user can retry', async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'gameclub-feedback-retry-'));
  try {
    const context = createContext({ messageText: 'Este bot es inútil' });
    await advanceToCapture(context);
    context.messageText = 'No se guardó el cambio que confirmé.';

    assert.equal(await handleTelegramFeedbackSessionText(context, { feedbackFile: tempDirectory }), true);
    assert.equal(context.session.current?.stepKey, 'capture');
    assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.saveFailed);

    const retryFile = join(tempDirectory, 'feedback.jsonl');
    assert.equal(await handleTelegramFeedbackSessionText(context, { feedbackFile: retryFile }), true);
    assert.equal(context.session.current, null);
    assert.equal(context.replies.at(-1)?.message, feedbackTexts.es.saved);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

function createContext({
  messageText,
  chatKind = 'private',
  isApproved = true,
  isBlocked = false,
}: {
  messageText: string;
  chatKind?: 'private' | 'group';
  isApproved?: boolean;
  isBlocked?: boolean;
}): TelegramCommandHandlerContext & {
  replies: Array<{ message: string; options: unknown }>;
  session: ConversationSessionRuntime;
} {
  const replies: Array<{ message: string; options: unknown }> = [];
  const session = createSessionRuntime();
  return {
    messageText,
    async reply(message, options) {
      replies.push({ message, options });
    },
    runtime: {
      bot: {
        publicName: 'Cawa',
        clubName: 'Cawa',
        language: 'es',
        async sendPrivateMessage() {},
      },
      services: {} as TelegramCommandHandlerContext['runtime']['services'],
      chat: { kind: chatKind, chatId: chatKind === 'private' ? 123 : -100123 },
      actor: {
        telegramUserId: 123,
        status: isBlocked ? 'blocked' : isApproved ? 'approved' : 'pending',
        isApproved,
        isBlocked,
        isAdmin: false,
        permissions: [],
      },
      authorization: {
        authorize: (permissionKey) => ({ allowed: true, permissionKey, reason: 'global-allow' }),
        can: () => true,
      },
      session,
      logger: { error() {} },
    },
    replies,
    session,
  };
}

async function advanceToCapture(
  context: ReturnType<typeof createContext>,
): Promise<void> {
  assert.equal(await offerTelegramFeedbackForLocalFrustration(context), true);
  context.messageText = feedbackTexts.es.accept;
  assert.equal(await handleTelegramFeedbackSessionText(context, {
    feedbackFile: '/unused/feedback.jsonl',
  }), true);
  assert.equal(context.session.current?.stepKey, 'capture');
}

function createSessionRuntime(): ConversationSessionRuntime {
  let current: ConversationSessionRecord | null = null;
  return {
    get current() {
      return current;
    },
    async start(input) {
      current = {
        key: 'telegram.session:123:123',
        flowKey: input.flowKey,
        stepKey: input.stepKey,
        data: input.data ?? {},
        createdAt: '2026-07-20T18:00:00.000Z',
        updatedAt: '2026-07-20T18:00:00.000Z',
        expiresAt: '2026-07-21T18:00:00.000Z',
      };
      return current;
    },
    async advance(input) {
      if (!current) {
        throw new Error('missing session');
      }
      current = { ...current, stepKey: input.stepKey, data: input.data };
      return current;
    },
    async cancel() {
      const hadSession = current !== null;
      current = null;
      return hadSession;
    },
  };
}
