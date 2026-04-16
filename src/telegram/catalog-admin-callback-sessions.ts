import type { CatalogItemRecord, CatalogMediaRecord } from '../catalog/catalog-model.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n } from './i18n.js';
import {
  buildDeactivateConfirmOptions,
  buildEditFieldMenuOptions,
  buildEditMediaTypeOptions,
  buildMediaDeleteConfirmOptions,
  buildSingleCancelKeyboard,
} from './catalog-admin-keyboards.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type SessionStarter = Pick<ConversationSessionRuntime, 'start'>;

export async function startCatalogAdminBrowseSearchSession({
  session,
  reply,
  language,
  browseFlowKey,
}: {
  session: SessionStarter;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  browseFlowKey: string;
}): Promise<void> {
  await session.start({ flowKey: browseFlowKey, stepKey: 'search-query', data: {} });
  await reply(createTelegramI18n(language).catalogAdmin.askSearchQuery, buildSingleCancelKeyboard());
}

export async function startCatalogAdminEditSelectionSession({
  session,
  reply,
  language,
  editFlowKey,
  itemId,
  item,
  itemDetailsMessage,
  itemTypeSupportsPlayers,
}: {
  session: SessionStarter;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  editFlowKey: string;
  itemId: number;
  item: CatalogItemRecord;
  itemDetailsMessage: string;
  itemTypeSupportsPlayers: (itemType: CatalogItemRecord['itemType']) => boolean;
}): Promise<void> {
  const texts = createTelegramI18n(language).catalogAdmin;
  await session.start({ flowKey: editFlowKey, stepKey: 'select-field', data: { itemId } });
  await reply(`${itemDetailsMessage}

${texts.selectEditField}`, { ...buildEditFieldMenuOptions({ itemType: item.itemType, itemTypeSupportsPlayers, language }), parseMode: 'HTML' });
}

export async function startCatalogAdminDeactivateSession({
  session,
  reply,
  language,
  deactivateFlowKey,
  itemId,
  itemDetailsMessage,
}: {
  session: SessionStarter;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  deactivateFlowKey: string;
  itemId: number;
  itemDetailsMessage: string;
}): Promise<void> {
  const texts = createTelegramI18n(language).catalogAdmin;
  await session.start({ flowKey: deactivateFlowKey, stepKey: 'confirm', data: { itemId } });
  await reply(`${itemDetailsMessage}

${texts.askDeactivate}`, { ...buildDeactivateConfirmOptions(language), parseMode: 'HTML' });
}

export async function startCatalogAdminEditMediaSession({
  session,
  reply,
  language,
  mediaFlowKey,
  media,
}: {
  session: SessionStarter;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  mediaFlowKey: string;
  media: CatalogMediaRecord;
}): Promise<void> {
  const texts = createTelegramI18n(language).catalogAdmin;
  await session.start({
    flowKey: mediaFlowKey,
    stepKey: 'media-type',
    data: {
      mediaId: media.id,
      itemId: media.itemId,
      mediaType: media.mediaType,
      url: media.url,
      altText: media.altText,
      sortOrder: media.sortOrder,
    },
  });
  await reply(texts.mediaTypePromptEdit, buildEditMediaTypeOptions(language));
}

export async function startCatalogAdminDeleteMediaSession({
  session,
  reply,
  language,
  mediaDeleteFlowKey,
  media,
}: {
  session: SessionStarter;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  mediaDeleteFlowKey: string;
  media: CatalogMediaRecord;
}): Promise<void> {
  const texts = createTelegramI18n(language).catalogAdmin;
  await session.start({ flowKey: mediaDeleteFlowKey, stepKey: 'confirm', data: { mediaId: media.id, itemId: media.itemId } });
  await reply(`${texts.confirmMediaDeletePrompt}
- ${media.mediaType} · ${media.url}`, buildMediaDeleteConfirmOptions(language));
}
