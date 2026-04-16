import type { CatalogItemType } from '../catalog/catalog-model.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n } from './i18n.js';
import {
  buildGroupOptions,
  buildSingleCancelKeyboard,
  buildSkipOptionalKeyboard,
  buildTypeOptions,
} from './catalog-admin-keyboards.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type SessionRuntime = Pick<ConversationSessionRuntime, 'advance'>;

export type CatalogAdminEditSelectionLabels = {
  confirmEdit: string;
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

export type CatalogAdminEditSelectionResult =
  | { kind: 'save' }
  | { kind: 'handled' };

export async function handleCatalogAdminEditSelectionStep({
  session,
  reply,
  language,
  text,
  data,
  currentItemType,
  currentFamilyId,
  labels,
  buildEditFieldMenuOptions,
  buildFamilyPrompt,
  buildFamilyOptions,
  buildGroupPrompt,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  text: string;
  data: Record<string, unknown>;
  currentItemType: CatalogItemType;
  currentFamilyId: number | null;
  labels: CatalogAdminEditSelectionLabels;
  buildEditFieldMenuOptions: (itemType: CatalogItemType) => TelegramReplyOptions;
  buildFamilyPrompt: () => Promise<string>;
  buildFamilyOptions: () => Promise<TelegramReplyOptions>;
  buildGroupPrompt: () => Promise<string>;
}): Promise<CatalogAdminEditSelectionResult> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (text === texts.confirmEdit || text === labels.confirmEdit) {
    return { kind: 'save' };
  }

  switch (text) {
    case texts.editFieldDisplayName:
    case labels.editFieldDisplayName:
      await session.advance({ stepKey: 'display-name', data });
      await reply(texts.askEditDisplayName, buildSingleCancelKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldItemType:
    case labels.editFieldItemType:
      await session.advance({ stepKey: 'item-type', data });
      await reply(texts.askEditItemType, buildTypeOptions(language));
      return { kind: 'handled' };
    case texts.editFieldFamily:
    case labels.editFieldFamily:
      await session.advance({ stepKey: 'family', data });
      await reply(await buildFamilyPrompt(), await buildFamilyOptions());
      return { kind: 'handled' };
    case texts.editFieldGroup:
    case labels.editFieldGroup:
      await session.advance({ stepKey: 'group', data });
      await reply(await buildGroupPrompt(), buildGroupOptions(language));
      return { kind: 'handled' };
    case texts.editFieldOriginalName:
    case labels.editFieldOriginalName:
      await session.advance({ stepKey: 'original-name', data });
      await reply(texts.askEditOriginalName, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldDescription:
    case labels.editFieldDescription:
      await session.advance({ stepKey: 'description', data });
      await reply(texts.askEditDescription, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldLanguage:
    case labels.editFieldLanguage:
      await session.advance({ stepKey: 'language', data });
      await reply(texts.askEditLanguage, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldPublisher:
    case labels.editFieldPublisher:
      await session.advance({ stepKey: 'publisher', data });
      await reply(texts.askEditPublisher, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldPublicationYear:
    case labels.editFieldPublicationYear:
      await session.advance({ stepKey: 'publication-year', data });
      await reply(texts.askEditPublicationYear, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldPlayerMin:
    case labels.editFieldPlayerMin:
      await session.advance({ stepKey: 'player-min', data });
      await reply(texts.askEditPlayerMin, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldPlayerMax:
    case labels.editFieldPlayerMax:
      await session.advance({ stepKey: 'player-max', data });
      await reply(texts.askEditPlayerMax, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldRecommendedAge:
    case labels.editFieldRecommendedAge:
      await session.advance({ stepKey: 'recommended-age', data });
      await reply(texts.askEditRecommendedAge, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldPlayTimeMinutes:
    case labels.editFieldPlayTimeMinutes:
      await session.advance({ stepKey: 'play-time-minutes', data });
      await reply(texts.askEditPlayTime, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldExternalRefs:
    case labels.editFieldExternalRefs:
      await session.advance({ stepKey: 'external-refs', data });
      await reply(texts.askEditExternalRefs, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    case texts.editFieldMetadata:
    case labels.editFieldMetadata:
      await session.advance({ stepKey: 'metadata', data });
      await reply(texts.askEditMetadata, buildSkipOptionalKeyboard(language));
      return { kind: 'handled' };
    default:
      await reply(texts.selectEditField, buildEditFieldMenuOptions(currentItemType));
      return { kind: 'handled' };
  }
}
