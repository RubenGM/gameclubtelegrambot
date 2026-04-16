import type { CatalogItemType } from '../catalog/catalog-model.js';
import type { CatalogLookupCandidate } from '../catalog/catalog-lookup-service.js';
import type {
  WikipediaBoardGameCatalogDraft,
  WikipediaBoardGameImportResult,
} from '../catalog/wikipedia-boardgame-import-service.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n } from './i18n.js';
import {
  buildGroupOptions,
  buildSingleCancelKeyboard,
  buildSkipOptionalKeyboard,
  buildTypeOptions,
  buildWikipediaCandidateOptions,
  buildWikipediaUrlOptions,
} from './catalog-admin-keyboards.js';
import {
  asLookupCandidates,
  asNullableNumber,
  asNullableString,
  asStringArray,
  parseLookupCandidateInput,
  parseOptionalJsonObject,
  parseOptionalPositiveInteger,
  parseWikipediaTitleFromUrl,
} from './catalog-admin-parsing.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type SessionRuntime = Pick<ConversationSessionRuntime, 'advance'>;

type CreateLabels = {
  confirmCreate: string;
  editFieldDisplayName: string;
  editFieldItemType: string;
  editFieldFamily: string;
  editFieldGroup: string;
  editFieldOriginalName: string;
  editFieldDescription: string;
  editFieldLanguage: string;
  editFieldPublisher: string;
  editFieldPublicationYear: string;
  editFieldPlayerMin: string;
  editFieldPlayerMax: string;
  editFieldRecommendedAge: string;
  editFieldPlayTimeMinutes: string;
  editFieldExternalRefs: string;
  editFieldMetadata: string;
};

export async function handleCatalogAdminCreateSession({
  session,
  reply,
  language,
  text,
  stepKey,
  data,
  labels,
  parseItemTypeLabel,
  buildCreateFieldMenuOptions,
  buildEditFieldMenuOptions,
  buildFamilyPrompt,
  buildFamilyOptions,
  buildGroupPrompt,
  updateCreateDraftAndReturn,
  saveCreateDraftAndReturn,
  parseFamilyInput,
  parseGroupInput,
  searchCatalogLookupCandidates,
  importWikipediaBoardGameDraft,
  createWikipediaImportedBoardGame,
  importWikipediaErrorMessage,
  formatDraftSummary,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  text: string;
  stepKey: string;
  data: Record<string, unknown>;
  labels: CreateLabels;
  parseItemTypeLabel: (text: string, language: 'ca' | 'es' | 'en') => CatalogItemType | Error;
  buildCreateFieldMenuOptions: (itemType: CatalogItemType) => TelegramReplyOptions;
  buildEditFieldMenuOptions: (itemType: CatalogItemType) => TelegramReplyOptions;
  buildFamilyPrompt: (itemType: CatalogItemType) => Promise<string>;
  buildFamilyOptions: (itemType: CatalogItemType) => Promise<TelegramReplyOptions>;
  buildGroupPrompt: (familyId: number | null) => Promise<string>;
  updateCreateDraftAndReturn: (data: Record<string, unknown>, patch: Record<string, unknown>) => Promise<boolean>;
  saveCreateDraftAndReturn: (data: Record<string, unknown>) => Promise<boolean>;
  parseFamilyInput: (text: string, itemType: CatalogItemType) => Promise<number | null | Error>;
  parseGroupInput: (text: string, familyId: number | null) => Promise<number | null | Error>;
  searchCatalogLookupCandidates: (input: { itemType: CatalogItemType; displayName: string; author?: string }) => Promise<CatalogLookupCandidate[]>;
  importWikipediaBoardGameDraft: (title: string) => Promise<WikipediaBoardGameImportResult>;
  createWikipediaImportedBoardGame: (baseData: Record<string, unknown>, draft: WikipediaBoardGameCatalogDraft, sourceTitle: string) => Promise<void>;
  importWikipediaErrorMessage: (result: Extract<WikipediaBoardGameImportResult, { ok: false }>) => string;
  formatDraftSummary: (data: Record<string, unknown>) => Promise<string>;
}): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (stepKey === 'item-type') {
    const itemType = parseItemTypeLabel(text, language);
    if (itemType instanceof Error) {
      await reply(texts.invalidType, buildTypeOptions(language));
      return true;
    }
    const nextData = { ...data, itemType };
    if (itemType === 'board-game' || itemType === 'book' || itemType === 'rpg-book') {
      await session.advance({ stepKey: 'display-name', data: nextData });
      await reply(texts.askDisplayName, buildSingleCancelKeyboard(language));
      return true;
    }
    await session.advance({ stepKey: 'select-field', data: nextData });
    await reply(texts.selectCreateField, buildCreateFieldMenuOptions(itemType));
    return true;
  }
  if (stepKey === 'select-field') {
    const itemType = getDraftItemTypeFromData(data);
    switch (text) {
      case texts.confirmCreate:
      case labels.confirmCreate:
        return saveCreateDraftAndReturn(data);
      case texts.editFieldDisplayName:
      case labels.editFieldDisplayName:
        await session.advance({ stepKey: 'display-name', data });
        await reply(texts.askDisplayName, buildSingleCancelKeyboard(language));
        return true;
      case texts.editFieldItemType:
      case labels.editFieldItemType:
        await session.advance({ stepKey: 'item-type', data });
        await reply(texts.askItemType, buildTypeOptions(language));
        return true;
      case texts.editFieldFamily:
      case labels.editFieldFamily:
        await session.advance({ stepKey: 'family', data });
        await reply(await buildFamilyPrompt(itemType), await buildFamilyOptions(itemType));
        return true;
      case texts.editFieldGroup:
      case labels.editFieldGroup:
        await session.advance({ stepKey: 'group', data });
        await reply(await buildGroupPrompt(asNullableNumber(data.familyId)), buildGroupOptions(language));
        return true;
      case texts.editFieldOriginalName:
      case labels.editFieldOriginalName:
        await session.advance({ stepKey: 'original-name', data });
        await reply(texts.askOriginalName, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldDescription:
      case labels.editFieldDescription:
        await session.advance({ stepKey: 'description', data });
        await reply(texts.askOptionalDescription, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldLanguage:
      case labels.editFieldLanguage:
        await session.advance({ stepKey: 'language', data });
        await reply(texts.askLanguage, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldPublisher:
      case labels.editFieldPublisher:
        await session.advance({ stepKey: 'publisher', data });
        await reply(texts.askPublisher, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldPublicationYear:
      case labels.editFieldPublicationYear:
        await session.advance({ stepKey: 'publication-year', data });
        await reply(texts.askPublicationYear, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldPlayerMin:
      case labels.editFieldPlayerMin:
        await session.advance({ stepKey: 'player-min', data });
        await reply(texts.askPlayerMin, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldPlayerMax:
      case labels.editFieldPlayerMax:
        await session.advance({ stepKey: 'player-max', data });
        await reply(texts.askPlayerMax, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldRecommendedAge:
      case labels.editFieldRecommendedAge:
        await session.advance({ stepKey: 'recommended-age', data });
        await reply(texts.askRecommendedAge, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldPlayTimeMinutes:
      case labels.editFieldPlayTimeMinutes:
        await session.advance({ stepKey: 'play-time-minutes', data });
        await reply(texts.askPlayTime, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldExternalRefs:
      case labels.editFieldExternalRefs:
        await session.advance({ stepKey: 'external-refs', data });
        await reply(texts.askExternalRefs, buildSkipOptionalKeyboard(language));
        return true;
      case texts.editFieldMetadata:
      case labels.editFieldMetadata:
        await session.advance({ stepKey: 'metadata', data });
        await reply(texts.askMetadata, buildSkipOptionalKeyboard(language));
        return true;
      case texts.searchOnlineServices:
        return handleCreateOnlineSearch({
          session,
          reply,
          language,
          data,
          buildCreateFieldMenuOptions,
          searchCatalogLookupCandidates,
        });
      default:
        await reply(texts.selectCreateField, buildCreateFieldMenuOptions(itemType));
        return true;
    }
  }
  if (stepKey === 'search-online-title') {
    return handleCreateOnlineSearch({
      session,
      reply,
      language,
      data: { ...data, displayName: text },
      buildCreateFieldMenuOptions,
      searchCatalogLookupCandidates,
    });
  }
  if (stepKey === 'display-name') {
    const itemType = String(data.itemType) as CatalogItemType;
    const nextData = { ...data, displayName: text };
    if (itemType === 'board-game') {
      await reply(texts.wikipediaSearching, buildSingleCancelKeyboard(language));
      const importResult = await importWikipediaBoardGameDraft(text);
      if (importResult.ok) {
        await createWikipediaImportedBoardGame(nextData, importResult.draft, text);
        return true;
      }
      if (importResult.error.type === 'ambiguous') {
        await session.advance({
          stepKey: 'wikipedia-candidate-choice',
          data: { ...nextData, wikipediaCandidates: importResult.error.candidates ?? [] },
        });
        await reply(
          `${importResult.error.message}\n\n${texts.invalidWikipediaCandidateChoice}\n\n${formatWikipediaCandidateLinks(importResult.error.candidates ?? [])}`,
          buildWikipediaCandidateOptions(importResult.error.candidates ?? [], language),
        );
        return true;
      }
      await session.advance({ stepKey: 'wikipedia-url', data: nextData });
      await reply(`${importWikipediaErrorMessage(importResult)}\n\n${texts.askWikipediaUrl}`, buildWikipediaUrlOptions(language));
      return true;
    }
    const lookupCandidates = await searchCatalogLookupCandidates({ itemType, displayName: text });
    if (lookupCandidates.length > 0) {
      await session.advance({ stepKey: 'lookup-choice', data: { ...nextData, lookupCandidates } });
      await reply(buildLookupChoicePrompt(language, lookupCandidates), buildLookupChoiceOptions(language, lookupCandidates));
      return true;
    }
    return updateCreateDraftAndReturn(nextData, {});
  }
  if (stepKey === 'family') {
    const itemType = String(data.itemType) as CatalogItemType;
    const familyId = await parseFamilyInput(text, itemType);
    if (familyId instanceof Error) {
      await reply(
        itemType === 'rpg-book' || itemType === 'book' ? texts.promptFamilyChooseBook : texts.invalidFamily,
        await buildFamilyOptions(itemType),
      );
      return true;
    }
    return updateCreateDraftAndReturn(data, { familyId, groupId: null });
  }
  if (stepKey === 'lookup-choice') {
    if (text === texts.skipLookupImport) {
      return updateCreateDraftAndReturn(data, {});
    }
    if (text === texts.refineLookupByAuthor) {
      await session.advance({ stepKey: 'lookup-author', data });
      await reply(texts.askLookupAuthor, buildSingleCancelKeyboard());
      return true;
    }
    const lookupCandidate = parseLookupCandidateInput(text, data.lookupCandidates);
    if (lookupCandidate instanceof Error) {
      const refined = await refineLookupCandidatesByAuthor({
        session,
        reply,
        language,
        data,
        author: text,
        searchCatalogLookupCandidates,
      });
      if (refined) {
        return true;
      }
      await reply(texts.invalidLookupChoice, buildLookupChoiceOptions(language, asLookupCandidates(data.lookupCandidates)));
      return true;
    }
    const nextData = applyLookupCandidateToDraft(data, lookupCandidate);
    if (!isExactTitleMatch(String(data.displayName ?? ''), lookupCandidate.title)) {
      await session.advance({ stepKey: 'lookup-title-choice', data: { ...nextData, selectedLookupCandidate: lookupCandidate } });
      await reply(buildLookupTitleChoicePrompt(String(data.displayName ?? ''), lookupCandidate.title), buildLookupTitleChoiceOptions(language));
      return true;
    }
    return updateCreateDraftAndReturn(nextData, {});
  }
  if (stepKey === 'lookup-title-choice') {
    const lookupCandidate = asLookupCandidateOrThrow(data.selectedLookupCandidate);
    if (text === texts.keepTypedTitle) {
      return updateCreateDraftAndReturn({ ...data, displayName: String(data.displayName ?? '') }, {});
    }
    if (text === texts.useApiTitle) {
      return updateCreateDraftAndReturn({ ...data, displayName: lookupCandidate.title }, {});
    }
    await reply(texts.askTitleChoice, buildLookupTitleChoiceOptions(language));
    return true;
  }
  if (stepKey === 'lookup-author') {
    const refined = await refineLookupCandidatesByAuthor({
      session,
      reply,
      language,
      data,
      author: text,
      searchCatalogLookupCandidates,
    });
    if (refined) {
      return true;
    }
    await reply(texts.lookupAuthorNoResults, buildSingleCancelKeyboard());
    return true;
  }
  if (stepKey === 'wikipedia-url') {
    if (text === texts.skipLookupImport) {
      return updateCreateDraftAndReturn(data, {});
    }
    const wikipediaTitle = parseWikipediaTitleFromUrl(text);
    if (!wikipediaTitle) {
      await reply(texts.invalidWikipediaUrl, buildWikipediaUrlOptions(language));
      return true;
    }
    await reply(texts.retryWikipediaUrl, buildSingleCancelKeyboard());
    const importResult = await importWikipediaBoardGameDraft(wikipediaTitle);
    if (importResult.ok) {
      await createWikipediaImportedBoardGame(data, importResult.draft, wikipediaTitle);
      return true;
    }
    await reply(
      `${importWikipediaErrorMessage(importResult)}\n\nSi vols, enganxa una altra URL o tria No importar dades per continuar manualment.`,
      buildWikipediaUrlOptions(language),
    );
    return true;
  }
  if (stepKey === 'wikipedia-candidate-choice') {
    const wikipediaCandidates = asStringArray(data.wikipediaCandidates);
    if (text === texts.skipLookupImport) {
      return updateCreateDraftAndReturn(data, {});
    }
    if (text === texts.manualWikipediaUrl) {
      await session.advance({ stepKey: 'wikipedia-url', data });
      await reply(texts.askWikipediaUrl, buildWikipediaUrlOptions(language));
      return true;
    }
    const selectedTitle = wikipediaCandidates.find((candidate) => candidate === text)
      ?? wikipediaCandidates.find((candidate) => normalizeTitleForComparison(candidate) === normalizeTitleForComparison(text));
    if (!selectedTitle) {
      await reply(texts.invalidWikipediaCandidateChoice, buildWikipediaCandidateOptions(wikipediaCandidates, language));
      return true;
    }
    await reply(`Torno a provar la importacio amb ${selectedTitle}...`, buildSingleCancelKeyboard());
    const importResult = await importWikipediaBoardGameDraft(selectedTitle);
    if (importResult.ok) {
      await createWikipediaImportedBoardGame(data, importResult.draft, selectedTitle);
      return true;
    }
    if (importResult.error.type === 'ambiguous') {
      await session.advance({
        stepKey: 'wikipedia-candidate-choice',
        data: { ...data, wikipediaCandidates: importResult.error.candidates ?? wikipediaCandidates },
      });
      await reply(
        `${importResult.error.message}\n\n${texts.invalidWikipediaCandidateChoice}\n\n${formatWikipediaCandidateLinks(importResult.error.candidates ?? wikipediaCandidates)}`,
        buildWikipediaCandidateOptions(importResult.error.candidates ?? wikipediaCandidates, language),
      );
      return true;
    }
    await reply(
      `${importWikipediaErrorMessage(importResult)}\n\nPots provar una altra opcio, entrar la URL manualment o ometre la importacio.`,
      buildWikipediaCandidateOptions(wikipediaCandidates, language),
    );
    return true;
  }
  if (stepKey === 'group') {
    const groupId = await parseGroupInput(text, asNullableNumber(data.familyId));
    if (groupId instanceof Error) {
      await reply(texts.invalidGroup, buildGroupOptions(language));
      return true;
    }
    return updateCreateDraftAndReturn({ ...data, groupId }, {});
  }
  if (stepKey === 'original-name') {
    return updateCreateDraftAndReturn(data, { originalName: text === texts.keepCurrent ? asNullableString(data.originalName) : text === texts.skipOptional ? null : text });
  }
  if (stepKey === 'description') {
    return updateCreateDraftAndReturn(data, { description: text === texts.keepCurrent ? asNullableString(data.description) : text === texts.skipOptional ? null : text });
  }
  if (stepKey === 'language') {
    return updateCreateDraftAndReturn(data, { language: text === texts.keepCurrent ? asNullableString(data.language) : text === texts.skipOptional ? null : text });
  }
  if (stepKey === 'publisher') {
    return updateCreateDraftAndReturn(data, { publisher: text === texts.keepCurrent ? asNullableString(data.publisher) : text === texts.skipOptional ? null : text });
  }
  if (stepKey === 'publication-year') {
    const publicationYear = text === texts.keepCurrent ? asNullableNumber(data.publicationYear) : parseOptionalPositiveInteger(text, language);
    if (publicationYear instanceof Error) {
      await reply(texts.invalidPublicationYear, buildCreateOptionalKeyboard(asNullableNumber(data.publicationYear), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { publicationYear });
  }
  if (stepKey === 'player-min') {
    const playerCountMin = text === texts.keepCurrent ? asNullableNumber(data.playerCountMin) : parseOptionalPositiveInteger(text, language);
    if (playerCountMin instanceof Error) {
      await reply(texts.invalidPlayerMin, buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMin), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { playerCountMin });
  }
  if (stepKey === 'player-max') {
    const playerCountMax = text === texts.keepCurrent ? asNullableNumber(data.playerCountMax) : parseOptionalPositiveInteger(text, language);
    if (playerCountMax instanceof Error) {
      await reply(texts.invalidPlayerMax, buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMax), language));
      return true;
    }
    if (playerCountMax !== null && typeof data.playerCountMin === 'number' && playerCountMax < data.playerCountMin) {
      await reply(texts.invalidPlayerRange, buildCreateOptionalKeyboard(asNullableNumber(data.playerCountMax), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { playerCountMax });
  }
  if (stepKey === 'recommended-age') {
    const recommendedAge = text === texts.keepCurrent ? asNullableNumber(data.recommendedAge) : parseOptionalPositiveInteger(text, language);
    if (recommendedAge instanceof Error) {
      await reply(texts.invalidRecommendedAge, buildCreateOptionalKeyboard(asNullableNumber(data.recommendedAge), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { recommendedAge });
  }
  if (stepKey === 'play-time-minutes') {
    const playTimeMinutes = text === texts.keepCurrent ? asNullableNumber(data.playTimeMinutes) : parseOptionalPositiveInteger(text, language);
    if (playTimeMinutes instanceof Error) {
      await reply(texts.invalidPlayTime, buildCreateOptionalKeyboard(asNullableNumber(data.playTimeMinutes), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { playTimeMinutes });
  }
  if (stepKey === 'external-refs') {
    const externalRefs = text === texts.keepCurrent ? asNullableObject(data.externalRefs) : parseOptionalJsonObject(text, language);
    if (externalRefs instanceof Error) {
      await reply(texts.invalidExternalRefs, buildCreateOptionalKeyboard(asNullableObject(data.externalRefs), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { externalRefs });
  }
  if (stepKey === 'metadata') {
    const metadata = text === texts.keepCurrent ? asNullableObject(data.metadata) : parseOptionalJsonObject(text, language);
    if (metadata instanceof Error) {
      await reply(texts.invalidMetadata, buildCreateOptionalKeyboard(asNullableObject(data.metadata), language));
      return true;
    }
    return updateCreateDraftAndReturn(data, { metadata });
  }
  if (stepKey === 'confirm') {
    if (text !== texts.confirmCreate && text !== labels.confirmCreate) {
      await reply(texts.confirmCreatePrompt, buildCreateFieldMenuOptions(getDraftItemTypeFromData(data)));
      return true;
    }
    return saveCreateDraftAndReturn(data);
  }
  return false;
}

async function handleCreateOnlineSearch({
  session,
  reply,
  language,
  data,
  buildCreateFieldMenuOptions,
  searchCatalogLookupCandidates,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  data: Record<string, unknown>;
  buildCreateFieldMenuOptions: (itemType: CatalogItemType) => TelegramReplyOptions;
  searchCatalogLookupCandidates: (input: { itemType: CatalogItemType; displayName: string; author?: string }) => Promise<CatalogLookupCandidate[]>;
}): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const itemType = getDraftItemTypeFromData(data);
  const displayName = String(data.displayName ?? '').trim();
  if (!displayName) {
    await session.advance({ stepKey: 'search-online-title', data });
    await reply(texts.askDisplayName, buildCreateFieldMenuOptions(itemType));
    return true;
  }
  const lookupCandidates = await searchCatalogLookupCandidates({ itemType, displayName });
  if (lookupCandidates.length > 0) {
    await session.advance({ stepKey: 'lookup-choice', data: { ...data, lookupCandidates } });
    await reply(buildLookupChoicePrompt(language, lookupCandidates), buildLookupChoiceOptions(language, lookupCandidates));
    return true;
  }
  await reply(texts.noResults.replace('{query}', displayName), buildCreateFieldMenuOptions(itemType));
  return true;
}

async function refineLookupCandidatesByAuthor({
  session,
  reply,
  language,
  data,
  author,
  searchCatalogLookupCandidates,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  data: Record<string, unknown>;
  author: string;
  searchCatalogLookupCandidates: (input: { itemType: CatalogItemType; displayName: string; author?: string }) => Promise<CatalogLookupCandidate[]>;
}): Promise<boolean> {
  const normalizedAuthor = author.trim();
  if (!normalizedAuthor) {
    return false;
  }
  const refinedCandidates = await searchCatalogLookupCandidates({
    itemType: String(data.itemType) as CatalogItemType,
    displayName: String(data.displayName ?? ''),
    author: normalizedAuthor,
  });
  if (refinedCandidates.length === 0) {
    return false;
  }
  await session.advance({ stepKey: 'lookup-choice', data: { ...data, lookupCandidates: refinedCandidates, lookupAuthor: normalizedAuthor } });
  await reply(buildLookupChoicePrompt(language, refinedCandidates), buildLookupChoiceOptions(language, refinedCandidates));
  return true;
}

function buildLookupChoicePrompt(language: 'ca' | 'es' | 'en', candidates: CatalogLookupCandidate[]): string {
  const texts = createTelegramI18n(language).catalogAdmin;
  return [texts.lookupChoicePrompt, ...candidates.map((candidate) => `- ${candidate.title} · ${candidate.summary}`)].join('\n');
}

function buildLookupChoiceOptions(language: 'ca' | 'es' | 'en', candidates: CatalogLookupCandidate[]): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return {
    replyKeyboard: [...candidates.map((candidate) => [candidate.title]), [texts.refineLookupByAuthor], [texts.skipLookupImport], [texts.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function buildLookupTitleChoicePrompt(typedTitle: string, apiTitle: string): string {
  return [
    'El titol trobat a la API no coincideix exactament amb el que has escrit.',
    `- El teu titol: ${typedTitle}`,
    `- Titol API: ${apiTitle}`,
    'Tria quin titol vols fer servir.',
  ].join('\n');
}

function buildLookupTitleChoiceOptions(language: 'ca' | 'es' | 'en' = 'ca'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return {
    replyKeyboard: [[texts.keepTypedTitle], [texts.useApiTitle], [texts.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function applyLookupCandidateToDraft(data: Record<string, unknown>, candidate: CatalogLookupCandidate): Record<string, unknown> {
  return {
    ...data,
    originalName: candidate.importedData.originalName,
    description: candidate.importedData.description,
    language: candidate.importedData.language,
    publisher: candidate.importedData.publisher,
    publicationYear: candidate.importedData.publicationYear,
    externalRefs: candidate.importedData.externalRefs,
    metadata: candidate.importedData.metadata,
  };
}

function getDraftItemTypeFromData(data: Record<string, unknown>): CatalogItemType {
  return String(data.itemType ?? 'board-game') as CatalogItemType;
}

function formatWikipediaCandidateLinks(candidateTitles: string[]): string {
  return candidateTitles.map((title) => `- ${title}`).join('\n');
}

function isExactTitleMatch(left: string, right: string): boolean {
  return normalizeTitleForComparison(left) === normalizeTitleForComparison(right);
}

function normalizeTitleForComparison(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function asLookupCandidateOrThrow(value: unknown): CatalogLookupCandidate {
  if (!value || typeof value !== 'object') {
    throw new Error('selected lookup candidate missing');
  }
  return value as CatalogLookupCandidate;
}

function buildCreateOptionalKeyboard(currentValue: number | Record<string, unknown> | null, language: 'ca' | 'es' | 'en'): TelegramReplyOptions {
  const texts = createTelegramI18n(language).catalogAdmin;
  return {
    replyKeyboard: [[texts.skipOptional], ...(currentValue !== null ? [[texts.keepCurrent]] : []), [texts.cancel]],
    resizeKeyboard: true,
    persistentKeyboard: true,
  };
}

function asNullableObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
