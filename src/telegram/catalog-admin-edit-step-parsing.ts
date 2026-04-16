import { createTelegramI18n } from './i18n.js';
import { buildSkipOptionalKeyboard } from './catalog-admin-keyboards.js';
import {
  parseOptionalJsonObject,
  parseOptionalPositiveInteger,
} from './catalog-admin-parsing.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export type CatalogAdminEditStepParseResult =
  | { kind: 'patch'; patch: Record<string, unknown> }
  | { kind: 'invalid'; message: string; options: TelegramReplyOptions };

export function parseCatalogAdminEditStepPatch({
  stepKey,
  text,
  language,
  candidateMin,
}: {
  stepKey: string;
  text: string;
  language: 'ca' | 'es' | 'en';
  candidateMin: number | null;
}): CatalogAdminEditStepParseResult | null {
  const texts = createTelegramI18n(language).catalogAdmin;
  const retryOptions = buildSkipOptionalKeyboard(language);

  if (stepKey === 'original-name') {
    return { kind: 'patch', patch: { originalName: text === texts.skipOptional ? null : text } };
  }
  if (stepKey === 'description') {
    return { kind: 'patch', patch: { description: text === texts.skipOptional ? null : text } };
  }
  if (stepKey === 'language') {
    return { kind: 'patch', patch: { language: text === texts.skipOptional ? null : text } };
  }
  if (stepKey === 'publisher') {
    return { kind: 'patch', patch: { publisher: text === texts.skipOptional ? null : text } };
  }
  if (stepKey === 'publication-year') {
    const publicationYear = parseOptionalPositiveInteger(text, language);
    if (publicationYear instanceof Error) {
      return { kind: 'invalid', message: texts.invalidPublicationYear, options: retryOptions };
    }
    return { kind: 'patch', patch: { publicationYear } };
  }
  if (stepKey === 'player-min') {
    const playerCountMin = parseOptionalPositiveInteger(text, language);
    if (playerCountMin instanceof Error) {
      return { kind: 'invalid', message: texts.invalidPlayerMin, options: retryOptions };
    }
    return { kind: 'patch', patch: { playerCountMin } };
  }
  if (stepKey === 'player-max') {
    const playerCountMax = parseOptionalPositiveInteger(text, language);
    if (playerCountMax instanceof Error) {
      return { kind: 'invalid', message: texts.invalidPlayerMax, options: retryOptions };
    }
    if (playerCountMax !== null && candidateMin !== null && playerCountMax < candidateMin) {
      return { kind: 'invalid', message: texts.invalidPlayerRange, options: retryOptions };
    }
    return { kind: 'patch', patch: { playerCountMax } };
  }
  if (stepKey === 'recommended-age') {
    const recommendedAge = parseOptionalPositiveInteger(text, language);
    if (recommendedAge instanceof Error) {
      return { kind: 'invalid', message: texts.invalidRecommendedAge, options: retryOptions };
    }
    return { kind: 'patch', patch: { recommendedAge } };
  }
  if (stepKey === 'play-time-minutes') {
    const playTimeMinutes = parseOptionalPositiveInteger(text, language);
    if (playTimeMinutes instanceof Error) {
      return { kind: 'invalid', message: texts.invalidPlayTime, options: retryOptions };
    }
    return { kind: 'patch', patch: { playTimeMinutes } };
  }
  if (stepKey === 'external-refs') {
    const externalRefs = parseOptionalJsonObject(text, language);
    if (externalRefs instanceof Error) {
      return { kind: 'invalid', message: texts.invalidExternalRefs, options: retryOptions };
    }
    return { kind: 'patch', patch: { externalRefs } };
  }
  if (stepKey === 'metadata') {
    const metadata = parseOptionalJsonObject(text, language);
    if (metadata instanceof Error) {
      return { kind: 'invalid', message: texts.invalidMetadata, options: retryOptions };
    }
    return { kind: 'patch', patch: { metadata } };
  }

  return null;
}
