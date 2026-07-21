import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { TelegramCommandHandlerContext } from './command-registry.js';
import { feedbackTexts } from './i18n-feedback.js';
import { normalizeBotLanguage, supportedBotLanguages, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const telegramFeedbackFlowKey = 'telegram-feedback';

export type TelegramFeedbackDetection = 'insult' | 'frustration';

const insultingWords = new Set([
  'idiota',
  'imbecil',
  'tonto',
  'tonta',
  'gilipollas',
  'capullo',
  'capulla',
  'estupido',
  'estupida',
  'patetico',
  'patetica',
  'ximple',
  'pallasso',
  'pallassa',
  'idiot',
  'moron',
]);

const frustrationPhrases = [
  'no funciona',
  'se ha roto',
  'esto no sirve',
  'no sirve para nada',
  'que desastre',
  'vaya desastre',
  'me tienes harto',
  'me tienes harta',
  'estoy harto',
  'estoy harta',
  's ha espatllat',
  'aixo no serveix',
  'no serveix per a res',
  'quin desastre',
  'em tens fart',
  'em tens farta',
  'estic fart',
  'estic farta',
  'does not work',
  'doesn t work',
  'is broken',
  'this does not help',
  'what a disaster',
  'i am fed up',
];

const botInsultPhrases = [
  'este bot es inutil',
  'este bot es una mierda',
  'este bot es basura',
  'aquest bot es inutil',
  'aquest bot es una merda',
  'this bot is useless',
  'this bot is garbage',
  'this bot is trash',
];

export function detectLocalBotFrustration(text: string): TelegramFeedbackDetection | null {
  const normalized = normalizeFeedbackText(text);
  if (!normalized) {
    return null;
  }

  if (normalized.split(' ').some((word) => insultingWords.has(word))) {
    return 'insult';
  }

  if (botInsultPhrases.some((phrase) => normalized.includes(phrase))) {
    return 'insult';
  }

  return frustrationPhrases.some((phrase) => normalized.includes(phrase)) ? 'frustration' : null;
}

export async function handleTelegramFeedbackSessionText(
  context: TelegramCommandHandlerContext,
  { feedbackFile }: { feedbackFile: string },
): Promise<boolean> {
  const session = context.runtime.session.current;
  if (session?.flowKey !== telegramFeedbackFlowKey) {
    return false;
  }
  if (context.runtime.chat.kind !== 'private' || !canUseTelegramFeedback(context)) {
    await context.runtime.session.cancel();
    return true;
  }

  const text = context.messageText?.trim();
  if (!text) {
    return true;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = feedbackTexts[language];
  if (text === '/cancel') {
    await context.runtime.session.cancel();
    await context.reply(texts.declined, buildStartKeyboard(language));
    return true;
  }

  if (session.stepKey === 'offer') {
    if (matchesFeedbackText(text, 'decline')) {
      await context.runtime.session.cancel();
      await context.reply(texts.declined, buildStartKeyboard(language));
      return true;
    }
    if (matchesFeedbackText(text, 'accept')) {
      await context.runtime.session.advance({ stepKey: 'capture', data: session.data });
      await context.reply(texts.prompt, { replyKeyboard: [['/cancel']], resizeKeyboard: true, persistentKeyboard: true });
      return true;
    }

    await context.reply(texts.offer, buildOfferKeyboard(language));
    return true;
  }

  if (session.stepKey !== 'capture') {
    return false;
  }

  if (text.length < 3) {
    await context.reply(texts.invalid, { replyKeyboard: [['/cancel']], resizeKeyboard: true, persistentKeyboard: true });
    return true;
  }
  if (text.length > 4_000) {
    await context.reply(texts.tooLong, { replyKeyboard: [['/cancel']], resizeKeyboard: true, persistentKeyboard: true });
    return true;
  }

  try {
    const detection = getDetection(session.data);
    await appendTelegramFeedback({
      feedbackFile,
      telegramUserId: context.runtime.actor.telegramUserId,
      message: text,
      detection,
    });
  } catch (error) {
    context.runtime.logger?.error?.(
      { error: error instanceof Error ? error.message : String(error) },
      'Telegram feedback could not be persisted',
    );
    await context.reply(texts.saveFailed, { replyKeyboard: [['/cancel']], resizeKeyboard: true, persistentKeyboard: true });
    return true;
  }

  await context.runtime.session.cancel();
  await context.reply(texts.saved, buildStartKeyboard(language));
  return true;
}

export async function offerTelegramFeedbackForLocalFrustration(
  context: TelegramCommandHandlerContext,
): Promise<boolean> {
  if (
    context.runtime.chat.kind !== 'private'
    || context.runtime.session.current
    || !canUseTelegramFeedback(context)
  ) {
    return false;
  }

  const text = context.messageText?.trim();
  if (!text || text.startsWith('/')) {
    return false;
  }

  const detection = detectLocalBotFrustration(text);
  if (!detection) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  await context.runtime.session.start({
    flowKey: telegramFeedbackFlowKey,
    stepKey: 'offer',
    data: { detection },
  });
  await context.reply(feedbackTexts[language].offer, buildOfferKeyboard(language));
  return true;
}

function canUseTelegramFeedback(context: TelegramCommandHandlerContext): boolean {
  return context.runtime.actor.isApproved && !context.runtime.actor.isBlocked;
}

async function appendTelegramFeedback({
  feedbackFile,
  telegramUserId,
  message,
  detection,
}: {
  feedbackFile: string;
  telegramUserId: number;
  message: string;
  detection: TelegramFeedbackDetection;
}): Promise<void> {
  const filePath = resolve(process.cwd(), feedbackFile);
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      topic: `bot-telegram-${detection}`,
      name: '',
      contact: `telegram:${telegramUserId}`,
      message,
      userAgent: 'telegram-local-dictionary',
      remoteAddress: '',
    })}\n`,
    'utf8',
  );
}

function normalizeFeedbackText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getDetection(data: Record<string, unknown>): TelegramFeedbackDetection {
  return data.detection === 'insult' ? 'insult' : 'frustration';
}

function matchesFeedbackText(text: string, key: 'accept' | 'decline'): boolean {
  return supportedBotLanguages.some((language) => feedbackTexts[language][key] === text);
}

function buildOfferKeyboard(language: BotLanguage): TelegramReplyOptions {
  const texts = feedbackTexts[language];
  return {
    replyKeyboard: [[texts.accept, texts.decline]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildStartKeyboard(language: BotLanguage): TelegramReplyOptions {
  return {
    replyKeyboard: [[language === 'ca' ? 'Inici' : language === 'es' ? 'Inicio' : 'Start']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}
