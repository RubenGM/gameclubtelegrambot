import { type BotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessageTransport } from './rich-message-transport.js';

const texts = {
  ca: { welcome: 'Benvingut al club', intro: 'Tria una opció del teclat per començar.' },
  es: { welcome: 'Bienvenido al club', intro: 'Elige una opción del teclado para empezar.' },
  en: { welcome: 'Welcome to the club', intro: 'Choose an option from the keyboard to get started.' },
} as const;

export function buildStartPresentation(input: {
  publicName: string;
  version: string;
  language: BotLanguage;
  isAdmin: boolean;
  isApproved: boolean;
  pendingMessage: string;
  summaries: Array<string | { message: string; richHtml: string }>;
}): { message: string; richHtml: string } {
  const t = texts[input.language];
  const title = escapeHtml(input.publicName);
  const intro = input.isApproved || input.isAdmin
    ? `${t.welcome}. ${t.intro}`
    : input.pendingMessage;
  const footer = input.isAdmin ? `<i>v${escapeHtml(input.version)}</i>` : '';
  return {
    message: [`<b>${title}</b>`, escapeHtml(intro), ...input.summaries.map((summary) => typeof summary === 'string' ? summary : summary.message), footer].filter(Boolean).join('\n\n'),
    richHtml: `<h2>${title}</h2><p>${escapeHtml(intro)}</p>${input.summaries.map((summary) => {
      if (typeof summary !== 'string') return summary.richHtml;
      const [heading, ...body] = summary.split('\n');
      return `<h3>${heading?.replace(/^<b>(.*)<\/b>$/, '$1') ?? ''}</h3><p>${body.join('<br>')}</p>`;
    }).join('')}${footer ? `<p>${footer}</p>` : ''}`,
  };
}

export async function replyWithStartPresentation(context: {
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: { chat: { chatId: number; kind: string }; bot: Partial<Pick<TelegramRichMessageTransport, 'sendRichMessage'>> };
}, start: { message: string; options: TelegramReplyOptions | undefined; richHtml?: string }): Promise<unknown> {
  if (start.richHtml && context.runtime.chat.kind === 'private' && context.runtime.bot.sendRichMessage) {
    return context.runtime.bot.sendRichMessage({ chatId: context.runtime.chat.chatId, richMessage: { html: start.richHtml }, fallbackText: start.message, ...(start.options ? { options: start.options } : {}) });
  }
  return context.reply(start.message, start.options);
}
