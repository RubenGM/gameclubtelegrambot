import { escapeHtml } from './catalog-presentation.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { renderTelegramRichDetailTable, splitDetailLines } from './rich-detail-message.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessage, TelegramRichMessageTransport } from './rich-message-transport.js';

type CatalogRichContext = {
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: {
    chat?: { chatId: number; messageThreadId?: number };
    bot: Partial<Pick<TelegramRichMessageTransport, 'sendRichMessage'>> & { language?: string };
  };
};

/** Only trusted, already escaped catalog HTML enters this renderer. */
export function buildCatalogRichMessage(title: string, html: string): TelegramRichMessage {
  const parts = [`<h2>${escapeHtml(title)}</h2>`];
  let listOpen = false;
  let tableOpen = false;
  const closeList = () => { if (listOpen) { parts.push('</ul>'); listOpen = false; } };
  const closeTable = () => { if (tableOpen) { parts.push('</table>'); tableOpen = false; } };
  const lines = splitDetailLines(html);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) { closeList(); closeTable(); continue; }
    if (line.startsWith('- ')) {
      closeTable();
      if (!listOpen) { parts.push('<ul>'); listOpen = true; }
      const subtitle = lines[index + 1];
      const hasSubtitle = subtitle?.startsWith('<i>');
      parts.push(`<li>${line.slice(2)}${hasSubtitle ? `<p>${subtitle}</p>` : ''}</li>`);
      if (hasSubtitle) index += 1;
      continue;
    }
    closeList();
    const field = /^<b>([^<]+:)<\/b>\s*([\s\S]+)$/.exec(line);
    if (field) {
      if (!tableOpen) { parts.push('<table>'); tableOpen = true; }
      parts.push(`<tr><th>${field[1]}</th><td>${field[2]}</td></tr>`);
    } else {
      closeTable();
      parts.push(`<p>${line}</p>`);
    }
  }
  closeList();
  closeTable();
  return { html: parts.join('') };
}

/** Match activity details while retaining permission-filtered fields and catalog navigation. */
export function buildCatalogRichDetailMessage(title: string, html: string, language = 'ca'): TelegramRichMessage {
  const texts = createTelegramI18n(normalizeBotLanguage(language, 'ca'));
  const fieldLabel = (label: string) => `${escapeHtml(label)}:`;
  const availabilityLabel = fieldLabel(texts.catalogLoan.availabilityAvailable);
  const descriptionLabel = fieldLabel(texts.catalogAdmin.description);
  const rows: Array<{ labelHtml: string; valueHtml: string }> = [];
  const descriptions: string[] = [];
  const introduction: string[] = [];
  const paragraphs: string[] = [];
  const heading = `<b>${escapeHtml(title)}</b>`;
  let bodyStarted = false;
  for (const line of splitDetailLines(html)) {
    if (!line.trim()) continue;
    if (line === heading) { bodyStarted = true; continue; }
    const field = /^<b>([^<]+:)<\/b>\s*([\s\S]+)$/.exec(line);
    if (field) {
      bodyStarted = true;
      const label = field[1]!;
      const value = field[2]!;
      if (label === descriptionLabel) { descriptions.push(value); continue; }
      const valueHtml = label === availabilityLabel
        ? value === escapeHtml(texts.catalogLoan.availabilityLoaned) ? `<mark>${value}</mark>` : `<b>${value}</b>`
        : value;
      rows.push({ labelHtml: label, valueHtml });
    } else if (line.startsWith(`${descriptionLabel} `)) {
      bodyStarted = true;
      descriptions.push(line.slice(descriptionLabel.length + 1));
    } else {
      (bodyStarted ? paragraphs : introduction).push(`<p>${line}</p>`);
    }
  }
  const descriptionHtml = descriptions.length
    ? `<h3>${escapeHtml(texts.catalogAdmin.description)}</h3>${descriptions.map((value) => `<p>${value.replace(/^<i>([\s\S]*)<\/i>$/, '$1')}</p>`).join('')}` : '';
  return { html: `<h2>${escapeHtml(title)}</h2>${introduction.join('')}${renderTelegramRichDetailTable(rows)}${descriptionHtml}${paragraphs.join('')}` };
}

export async function replyWithCatalogRichMessage(
  context: CatalogRichContext,
  text: string,
  options?: TelegramReplyOptions,
  detailTitle?: string,
): Promise<unknown> {
  if (options?.parseMode !== 'HTML' || !context.runtime.bot.sendRichMessage || !context.runtime.chat) {
    return context.reply(text, options);
  }
  const title = detailTitle ?? createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).actionMenu.catalog;
  const detailHtml = detailTitle
    ? splitDetailLines(text).map((line) => {
      const heading = `<b>${escapeHtml(detailTitle)}</b>`;
      const id = line.startsWith(heading) ? /^ \(#(\d+)\)$/.exec(line.slice(heading.length)) : null;
      return id ? `<b>ID:</b> <code>#${id[1]}</code>` : line;
    }).join('\n')
    : text;
  return context.runtime.bot.sendRichMessage({
    chatId: context.runtime.chat.chatId,
    richMessage: detailTitle ? buildCatalogRichDetailMessage(detailTitle, detailHtml, context.runtime.bot.language) : buildCatalogRichMessage(title, text),
    fallbackText: text,
    options,
    ...(context.runtime.chat.messageThreadId !== undefined ? { messageThreadId: context.runtime.chat.messageThreadId } : {}),
  });
}
