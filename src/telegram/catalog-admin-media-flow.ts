import {
  createCatalogMedia,
  removeCatalogMedia,
  updateCatalogMedia,
} from '../catalog/catalog-model.js';
import type { CatalogMediaType } from '../catalog/catalog-model.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n } from './i18n.js';
import {
  buildCatalogAdminMenuOptions,
  buildEditMediaTypeOptions,
  buildEditOptionalKeyboard,
  buildKeepCurrentKeyboard,
  buildMediaConfirmOptions,
  buildMediaDeleteConfirmOptions,
  buildMediaEditConfirmOptions,
  buildMediaTypeOptions,
  buildSingleCancelKeyboard,
  buildSkipOptionalKeyboard,
} from './catalog-admin-keyboards.js';
import {
  asNullableNumber,
  asNullableString,
  parseMediaTypeLabel,
  parseOptionalNonNegativeInteger,
} from './catalog-admin-parsing.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

type SessionRuntime = Pick<ConversationSessionRuntime, 'advance' | 'cancel'>;
type CatalogRepository = Parameters<typeof createCatalogMedia>[0]['repository'];
type AuditRepository = Parameters<typeof appendAuditEvent>[0]['repository'];

export async function handleCatalogAdminMediaSession({
  session,
  reply,
  language,
  text,
  stepKey,
  data,
  repository,
  auditRepository,
  actorTelegramUserId,
  menuLanguage,
  confirmMediaCreateLabel,
  confirmMediaEditLabel,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  text: string;
  stepKey: string;
  data: Record<string, unknown>;
  repository: CatalogRepository;
  auditRepository: AuditRepository;
  actorTelegramUserId: number;
  menuLanguage: 'ca' | 'es' | 'en';
  confirmMediaCreateLabel: string;
  confirmMediaEditLabel: string;
}): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  const isEditing = typeof data.mediaId === 'number';
  if (stepKey === 'media-type') {
    const mediaType = text === texts.keepCurrent ? String(data.mediaType) : parseMediaTypeLabel(text, language);
    if (mediaType instanceof Error) {
      await reply(texts.invalidMediaType, isEditing ? buildEditMediaTypeOptions(language) : buildMediaTypeOptions(language));
      return true;
    }
    await session.advance({ stepKey: 'url', data: { ...data, mediaType } });
    await reply(texts.askMediaUrl, isEditing ? buildKeepCurrentKeyboard(language) : buildSingleCancelKeyboard(language));
    return true;
  }
  if (stepKey === 'url') {
    await session.advance({
      stepKey: 'alt-text',
      data: { ...data, url: text === texts.keepCurrent ? String(data.url ?? '') : text },
    });
    await reply(texts.askMediaAltText, isEditing ? buildEditOptionalKeyboard(language) : buildSkipOptionalKeyboard(language));
    return true;
  }
  if (stepKey === 'alt-text') {
    await session.advance({
      stepKey: 'sort-order',
      data: {
        ...data,
        altText: text === texts.keepCurrent ? asNullableString(data.altText) : text === texts.skipOptional ? null : text,
      },
    });
    await reply(texts.askMediaSortOrder, isEditing ? buildEditOptionalKeyboard(language) : buildSkipOptionalKeyboard(language));
    return true;
  }
  if (stepKey === 'sort-order') {
    const sortOrder = text === texts.keepCurrent ? asNullableNumber(data.sortOrder) ?? 0 : parseOptionalNonNegativeInteger(text, language);
    if (sortOrder instanceof Error) {
      await reply(texts.invalidMediaSortOrder, isEditing ? buildEditOptionalKeyboard(language) : buildSkipOptionalKeyboard(language));
      return true;
    }
    const nextData = { ...data, sortOrder };
    await session.advance({ stepKey: 'confirm', data: nextData });
    await reply(buildCatalogAdminMediaDraftSummary(nextData), isEditing ? buildMediaEditConfirmOptions(language) : buildMediaConfirmOptions(language));
    return true;
  }
  if (stepKey === 'confirm') {
    const expected = isEditing ? confirmMediaEditLabel : confirmMediaCreateLabel;
    const options = isEditing ? buildMediaEditConfirmOptions(language) : buildMediaConfirmOptions(language);
    if (text !== expected) {
      await reply(texts.confirmMediaPrompt, options);
      return true;
    }
    const draftSortOrder = asNullableNumber(data.sortOrder);
    const media = isEditing
      ? await updateCatalogMedia({
        repository,
        mediaId: Number(data.mediaId),
        mediaType: String(data.mediaType) as CatalogMediaType,
        url: String(data.url ?? ''),
        altText: asNullableString(data.altText),
        sortOrder: draftSortOrder ?? 0,
      })
      : await createCatalogMedia({
        repository,
        familyId: null,
        itemId: Number(data.itemId),
        mediaType: String(data.mediaType) as CatalogMediaType,
        url: String(data.url ?? ''),
        altText: asNullableString(data.altText),
        ...(draftSortOrder === null ? {} : { sortOrder: draftSortOrder }),
      });
    await appendAuditEvent({
      repository: auditRepository,
      actorTelegramUserId,
      actionKey: isEditing ? 'catalog.media.updated' : 'catalog.media.created',
      targetType: 'catalog-media',
      targetId: media.id,
      summary: isEditing ? `Media de cataleg actualitzat #${media.id}` : `Media de cataleg creat per l item #${media.itemId}`,
      details: { itemId: media.itemId, mediaType: media.mediaType, url: media.url, sortOrder: media.sortOrder },
    });
    await session.cancel();
    await reply(
      isEditing ? `${texts.mediaUpdated} (#${media.id}).` : `${texts.mediaAdded} #${media.itemId}.`,
      buildCatalogAdminMenuOptions(menuLanguage),
    );
    return true;
  }
  return false;
}

export async function handleCatalogAdminMediaDeleteSession({
  session,
  reply,
  language,
  text,
  data,
  repository,
  auditRepository,
  actorTelegramUserId,
  menuLanguage,
  confirmMediaDeleteLabel,
}: {
  session: SessionRuntime;
  reply: (message: string, options?: TelegramReplyOptions) => Promise<unknown>;
  language: 'ca' | 'es' | 'en';
  text: string;
  data: Record<string, unknown>;
  repository: CatalogRepository;
  auditRepository: AuditRepository;
  actorTelegramUserId: number;
  menuLanguage: 'ca' | 'es' | 'en';
  confirmMediaDeleteLabel: string;
}): Promise<boolean> {
  const texts = createTelegramI18n(language).catalogAdmin;
  if (text !== texts.confirmMediaDelete && text !== confirmMediaDeleteLabel) {
    await reply(texts.confirmMediaDeletePrompt, buildMediaDeleteConfirmOptions(language));
    return true;
  }
  await removeCatalogMedia({ repository, mediaId: Number(data.mediaId) });
  await appendAuditEvent({
    repository: auditRepository,
    actorTelegramUserId,
    actionKey: 'catalog.media.deleted',
    targetType: 'catalog-media',
    targetId: Number(data.mediaId),
    summary: `Media de cataleg eliminat #${Number(data.mediaId)}`,
    details: { itemId: asNullableNumber(data.itemId) },
  });
  await session.cancel();
  await reply(`${texts.mediaDeleted} (#${Number(data.mediaId)}).`, buildCatalogAdminMenuOptions(menuLanguage));
  return true;
}

export function buildCatalogAdminMediaDraftSummary(data: Record<string, unknown>): string {
  const lines = [`Tipus: ${String(data.mediaType ?? '')}`, `URL: ${String(data.url ?? '')}`];
  const altText = asNullableString(data.altText);
  lines.push(`Alt: ${altText ?? '-'}`);
  lines.push(`Ordre: ${String(asNullableNumber(data.sortOrder) ?? 0)}`);
  return lines.join('\n');
}
