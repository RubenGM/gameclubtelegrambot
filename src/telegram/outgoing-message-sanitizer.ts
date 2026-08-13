export const telegramMessageTextLimit = 4_096;
export const telegramCaptionTextLimit = 1_024;

export type TelegramOutgoingParseMode = 'HTML' | undefined;

export interface TelegramOutgoingSanitizationResult {
  text: string;
  changed: boolean;
  originalLength: number;
}

export function splitTelegramOutgoingMessage(
  input: string,
  parseMode?: TelegramOutgoingParseMode,
): TelegramOutgoingSanitizationResult[] {
  const normalized = normalizeTelegramOutgoingCharacters(input);
  const chunks = parseMode === 'HTML'
    ? splitHtmlMessage(normalized, telegramMessageTextLimit)
    : splitPlainMessage(normalized, telegramMessageTextLimit);
  const changed = normalized !== input || chunks.length > 1;

  return chunks.map((text) => ({ text, changed, originalLength: input.length }));
}

export function truncateTelegramOutgoingCaption(
  input: string,
  parseMode?: TelegramOutgoingParseMode,
): TelegramOutgoingSanitizationResult {
  return truncateTelegramOutgoingText(input, telegramCaptionTextLimit, parseMode);
}

export function truncateTelegramOutgoingMessage(
  input: string,
  parseMode?: TelegramOutgoingParseMode,
): TelegramOutgoingSanitizationResult {
  return truncateTelegramOutgoingText(input, telegramMessageTextLimit, parseMode);
}

function truncateTelegramOutgoingText(
  input: string,
  maxLength: number,
  parseMode?: TelegramOutgoingParseMode,
): TelegramOutgoingSanitizationResult {
  const normalized = normalizeTelegramOutgoingCharacters(input);
  const visibleLength = measureVisibleLength(normalized, parseMode);
  if (visibleLength <= maxLength) {
    return {
      text: normalized,
      changed: normalized !== input,
      originalLength: input.length,
    };
  }

  const text = parseMode === 'HTML'
    ? truncateHtmlMessage(normalized, maxLength)
    : truncatePlainMessage(normalized, maxLength);
  return { text, changed: true, originalLength: input.length };
}

function normalizeTelegramOutgoingCharacters(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function splitPlainMessage(input: string, maxLength: number): string[] {
  if (input.length <= maxLength) {
    return [input];
  }

  const chunks: string[] = [];
  let current = '';
  for (const character of input) {
    if (current.length + character.length > maxLength) {
      chunks.push(current);
      current = '';
    }
    current += character;
  }
  if (current || chunks.length === 0) {
    chunks.push(current);
  }
  return chunks;
}

function truncatePlainMessage(input: string, maxLength: number): string {
  let result = '';
  for (const character of input) {
    if (result.length + character.length > maxLength - 1) {
      break;
    }
    result += character;
  }
  return `${result}…`;
}

function splitHtmlMessage(input: string, maxLength: number): string[] {
  if (measureHtmlVisibleLength(input) <= maxLength) {
    return [input];
  }

  const chunks: string[] = [];
  const openTags: HtmlOpenTag[] = [];
  let current = '';
  let visibleLength = 0;

  for (const token of tokenizeHtml(input)) {
    const tokenLength = htmlTokenVisibleLength(token);
    if (tokenLength > 0 && visibleLength + tokenLength > maxLength) {
      chunks.push(`${current}${closeHtmlTags(openTags)}`);
      current = openTags.map((tag) => tag.source).join('');
      visibleLength = 0;
    }

    current += token;
    visibleLength += tokenLength;
    updateOpenHtmlTags(openTags, token);
  }

  if (current || chunks.length === 0) {
    chunks.push(`${current}${closeHtmlTags(openTags)}`);
  }
  return chunks;
}

function truncateHtmlMessage(input: string, maxLength: number): string {
  const openTags: HtmlOpenTag[] = [];
  let current = '';
  let visibleLength = 0;

  for (const token of tokenizeHtml(input)) {
    const tokenLength = htmlTokenVisibleLength(token);
    if (tokenLength > 0 && visibleLength + tokenLength > maxLength - 1) {
      return `${current}…${closeHtmlTags(openTags)}`;
    }
    current += token;
    visibleLength += tokenLength;
    updateOpenHtmlTags(openTags, token);
  }
  return current;
}

function measureVisibleLength(input: string, parseMode?: TelegramOutgoingParseMode): number {
  return parseMode === 'HTML' ? measureHtmlVisibleLength(input) : input.length;
}

function measureHtmlVisibleLength(input: string): number {
  return tokenizeHtml(input).reduce((total, token) => total + htmlTokenVisibleLength(token), 0);
}

function tokenizeHtml(input: string): string[] {
  return input.match(/<[^>]+>|&(?:#[0-9]+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);|[\s\S]/gu) ?? [];
}

function htmlTokenVisibleLength(token: string): number {
  if (token.startsWith('<')) {
    return 0;
  }
  if (token.startsWith('&') && token.endsWith(';')) {
    return 1;
  }
  return token.length;
}

interface HtmlOpenTag {
  name: string;
  source: string;
}

function updateOpenHtmlTags(openTags: HtmlOpenTag[], token: string): void {
  const closeMatch = /^<\/([A-Za-z0-9-]+)\s*>$/.exec(token);
  if (closeMatch) {
    const matchingIndex = openTags.map((tag) => tag.name).lastIndexOf(closeMatch[1]!.toLowerCase());
    if (matchingIndex >= 0) {
      openTags.splice(matchingIndex, 1);
    }
    return;
  }

  const openMatch = /^<([A-Za-z0-9-]+)(?:\s[^>]*)?>$/.exec(token);
  if (openMatch && !token.endsWith('/>')) {
    openTags.push({ name: openMatch[1]!.toLowerCase(), source: token });
  }
}

function closeHtmlTags(openTags: HtmlOpenTag[]): string {
  return [...openTags].reverse().map((tag) => `</${tag.name}>`).join('');
}
