import type { StorageAttachmentKind, StorageEntryDetailRecord } from '../storage/storage-catalog.js';
import { escapeHtml } from './schedule-presentation.js';
import { buildTelegramRichDetailMessage } from './rich-detail-message.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import type { TelegramRichMessageTransport } from './rich-message-transport.js';

const labels = {
  ca: { document: 'Documents', photo: 'Imatges', video: 'Vídeos', audio: 'Àudio', text: 'Text', mixed: 'Contingut mixt', file: 'Arxiu', size: 'Mida', count: 'Adjunts', categories: 'Categories', subcategories: 'Subcategories', files: 'Arxius', tag: 'Tag' },
  es: { document: 'Documentos', photo: 'Imágenes', video: 'Vídeos', audio: 'Audio', text: 'Texto', mixed: 'Contenido mixto', file: 'Archivo', size: 'Tamaño', count: 'Adjuntos', categories: 'Categorías', subcategories: 'Subcategorías', files: 'Archivos', tag: 'Tag' },
  en: { document: 'Documents', photo: 'Images', video: 'Videos', audio: 'Audio', text: 'Text', mixed: 'Mixed content', file: 'File', size: 'Size', count: 'Attachments', categories: 'Categories', subcategories: 'Subcategories', files: 'Files', tag: 'Tag' },
} as const;

export function renderStorageRichEntryTable(input: {
  details: StorageEntryDetailRecord[];
  language: BotLanguage;
  entryLink: (detail: StorageEntryDetailRecord) => string;
  tagLinks: (tags: string[]) => string;
  showTags?: boolean;
}): string {
  const texts = labels[input.language];
  const groups = new Map<StorageAttachmentKind | 'mixed', StorageEntryDetailRecord[]>();
  for (const detail of input.details) {
    const kinds = [...new Set(detail.messages.map((message) => message.attachmentKind).filter((kind) => kind !== 'text'))];
    const kind = kinds.length > 1 ? 'mixed' : kinds[0] ?? 'text';
    const group = groups.get(kind) ?? [];
    group.push(detail);
    groups.set(kind, group);
  }
  return (['document', 'photo', 'video', 'audio', 'mixed', 'text'] as const).flatMap((kind) => {
    const details = groups.get(kind);
    if (!details?.length) return [];
    const rows = details.map((detail) => {
      const files = detail.messages.filter((message) => message.attachmentKind !== 'text');
      const sizes = files.map((file) => file.fileSizeBytes).filter((size): size is number => size !== null);
      const size = sizes.length ? `${sizes.length < files.length ? '≥ ' : ''}${formatStorageRichFileSize(sizes.reduce((total, bytes) => total + bytes, 0))}` : '—';
      const title = detail.entry.description?.trim();
      const names = files.map((file) => file.originalFileName).filter((name): name is string => Boolean(name));
      const secondary: string[] = [];
      if (names.length && title) secondary.push(escapeHtml(names.slice(0, 2).join(' · ')));
      if (input.showTags !== false && detail.entry.tags.length) secondary.push(input.tagLinks(detail.entry.tags));
      return `<tr><td>${input.entryLink(detail)}</td><td>${escapeHtml(size)}</td><td align="center">${files.length}</td></tr>${secondary.length ? `<tr><td colspan="3"><i>${secondary.join(' · ')}</i></td></tr>` : ''}`;
    });
    return [`<h3>${texts[kind]}</h3><table compact><tr><th>${texts.file}</th><th>${texts.size}</th><th>${texts.count}</th></tr>${rows.join('')}</table>`];
  }).join('');
}

export function renderStorageRichCategoryTable(rows: Array<{ linkHtml: string; entryCount?: number; subcategoryCount?: number }>, language: BotLanguage): string {
  if (!rows.length) return '';
  const texts = labels[language];
  return `<table compact><tr><th>${texts.categories}</th><th>${texts.files}</th><th>${texts.subcategories}</th></tr>${rows.map((row) => `<tr><td>${row.linkHtml}</td><td align="center">${row.entryCount ?? '—'}</td><td align="center">${row.subcategoryCount ?? '—'}</td></tr>`).join('')}</table>`;
}

export function renderStorageRichTagTable(rows: Array<{ linkHtml: string; count: number }>, language: BotLanguage): string {
  const texts = labels[language];
  return `<table compact><tr><th>${texts.tag}</th><th>${texts.files}</th></tr>${rows.map((row) => `<tr><td>${row.linkHtml}</td><td align="center">${row.count}</td></tr>`).join('')}</table>`;
}

export function formatStorageRichFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

type StorageRichContext = {
  reply(text: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: { chat: { chatId: number; messageThreadId?: number }; bot: Partial<Pick<TelegramRichMessageTransport, 'sendRichMessage'>> & { language?: string } };
};

export async function replyWithStorageRichMessage(context: StorageRichContext, fallbackText: string, options?: TelegramReplyOptions, richHtml?: string): Promise<unknown> {
  if (options?.parseMode !== 'HTML' || !context.runtime.bot.sendRichMessage) return context.reply(fallbackText, options);
  const title = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).actionMenu.storage;
  const richMessage = richHtml ? { html: `<h2>${escapeHtml(title)}</h2>${richHtml}` } : buildTelegramRichDetailMessage(title, fallbackText);
  return context.runtime.bot.sendRichMessage({ chatId: context.runtime.chat.chatId, richMessage, fallbackText, options, ...(context.runtime.chat.messageThreadId !== undefined ? { messageThreadId: context.runtime.chat.messageThreadId } : {}) });
}
