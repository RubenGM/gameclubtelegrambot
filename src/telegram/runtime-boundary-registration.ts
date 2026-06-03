import { APP_VERSION } from '../app-version.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import {
  elevateApprovedUserToAdmin,
  grantAdminRoleToUser,
  revokeAdminRoleFromUser,
} from '../membership/admin-elevation.js';
import { createDatabaseAdminElevationRepository } from '../membership/admin-elevation-store.js';
import {
  approveMembershipRequest,
  listManageableMembershipUsers,
  listRevocableMembershipUsers,
  listPendingMembershipRequests,
  rejectMembershipRequest,
  revokeMembershipAccess,
  requestMembershipAccess,
  updateMembershipDisplayName,
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { normalizeDisplayName, resolveTelegramDisplayName } from '../membership/display-name.js';
import {
  createAppMetadataWelcomeTemplateStore,
  renderWelcomeTemplateHtml,
  renderWelcomeTemplate,
  type WelcomeMessageTemplate,
} from '../membership/welcome-template-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import {
  createAppMetadataMembershipRequestNotificationSubscriptionStore,
  notifyApprovedAdminsOfMembershipRevocation,
  notifySubscribedAdminsOfMembershipRequest,
  toggleMembershipRequestNotifications,
} from '../membership/request-notification-store.js';
import {
  createAppMetadataMembershipAutojoinStore,
  toggleMembershipAutojoin,
} from '../membership/autojoin-store.js';
import {
  resolveTelegramActionMenu,
  resolveTelegramMenuSelection,
  type TelegramResolvedActionMenu,
} from './action-menu.js';
import { handleTelegramCalendarText } from './calendar-flow.js';
import {
  handleTelegramCatalogAdminCallback,
  handleTelegramCatalogAdminMessage,
  handleTelegramCatalogAdminStartText,
  handleTelegramCatalogAdminText,
  catalogAdminCallbackPrefixes,
} from './catalog-admin-flow.js';
import {
  handleTelegramCatalogLoanCallback,
  handleTelegramCatalogLoanText,
  catalogLoanCallbackPrefixes,
} from './catalog-loan-flow.js';
import {
  handleTelegramCatalogReadCallback,
  handleTelegramCatalogReadCommand,
  handleTelegramCatalogReadStartText,
  handleTelegramCatalogReadText,
  catalogReadCallbackPrefixes,
} from './catalog-read-flow.js';
import {
  TelegramInteractionError,
  registerTelegramCommands,
  renderTelegramHelpMessage,
  type TelegramCommandDefinition,
  type TelegramCommandHandlerContext,
  type TelegramHelpSection,
} from './command-registry.js';
import { createAppMetadataTelegramLanguagePreferenceStore } from './language-preference-store.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage, supportedBotLanguages } from './i18n.js';
import { handleTelegramLanguageCommand, handleTelegramLanguageText } from './language-flow.js';
import {
  handleTelegramLfgCallback,
  handleTelegramLfgCommand,
  handleTelegramLfgText,
  lfgCallbackPrefixes,
} from './lfg-flow.js';
import {
  handleTelegramNewsGroupCallback,
  handleTelegramNewsGroupText,
  newsGroupCallbackPrefixes,
} from './news-group-flow.js';
import {
  buildNoticeStartSummary,
  handleTelegramNoticeCallback,
  handleTelegramNoticeCommand,
  handleTelegramNoticeMessage,
  handleTelegramNoticeText,
  noticeCallbackPrefixes,
} from './notice-flow.js';
import { buildTodayAtClubSummary } from './today-at-club-summary.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { renderTelegramMessageTextAsHtml } from './telegram-entity-html.js';
import {
  groupPurchaseCallbackPrefixes,
  handleTelegramGroupPurchaseCallback,
  handleTelegramGroupPurchaseCommand,
  handleTelegramGroupPurchaseStartText,
  handleTelegramGroupPurchaseText,
} from './group-purchase-flow.js';
import {
  handleTelegramStorageCallback,
  handleTelegramStorageCommand,
  handleTelegramStorageMessage,
  handleTelegramStorageStartText,
  handleTelegramStorageText,
  storageCallbackPrefixes,
} from './storage-flow.js';
import {
  handleTelegramScheduleCallback,
  handleTelegramScheduleMessage,
  handleTelegramScheduleStartText,
  handleTelegramScheduleText,
  scheduleCallbackPrefixes,
} from './schedule-flow.js';
import {
  handleTelegramTableAdminCallback,
  handleTelegramTableAdminStartText,
  handleTelegramTableAdminText,
  tableAdminCallbackPrefixes,
} from './table-admin-flow.js';
import {
  handleTelegramTableReadCallback,
  handleTelegramTableReadCommand,
  handleTelegramTableReadStartText,
  tableReadCallbackPrefixes,
} from './table-read-flow.js';
import {
  handleTelegramVenueEventAdminCallback,
  handleTelegramVenueEventAdminStartText,
  handleTelegramVenueEventAdminText,
  venueEventAdminCallbackPrefixes,
} from './venue-event-admin-flow.js';
import type {
  TelegramBotLike,
  TelegramButtonAppearanceConfig,
  TelegramInlineButton,
  TelegramReplyOptions,
  TelegramReplyButton,
  TelegramReplyKeyboardButton,
} from './runtime-boundary.js';

const membershipRevokeFlowKey = 'membership-revoke';
const membershipUserManagementFlowKey = 'membership-user-management';
const membershipAccessDisplayNameFlowKey = 'membership-access-display-name';
const membershipChangeDisplayNameFlowKey = 'membership-change-display-name';
const welcomeTemplateAdminFlowKey = 'welcome-template-admin';
const welcomeTemplateAdminPageSize = 5;
const welcomeTemplateListPagePrefix = 'welcome_tpl:list:';
const welcomeTemplateDetailPrefix = 'welcome_tpl:detail:';
const welcomeTemplateEditTextPrefix = 'welcome_tpl:edit_text:';
const welcomeTemplateEditMediaPrefix = 'welcome_tpl:edit_media:';
const welcomeTemplateTogglePrefix = 'welcome_tpl:toggle:';
const welcomeTemplateDeleteConfirmPrefix = 'welcome_tpl:delete_confirm:';
const welcomeTemplateDeletePrefix = 'welcome_tpl:delete:';
const welcomeTemplateCreateCallback = 'welcome_tpl:create';
const welcomeTemplateLastPickedPrefix = 'telegram.welcome_last_template:';
const welcomeTemplateStartCreatePayload = 'welcome_tpl_create';
const welcomeTemplateStartListPrefix = 'welcome_tpl_list_';
const welcomeTemplateStartDetailPrefix = 'welcome_tpl_detail_';
const welcomeTemplateStartEditTextPrefix = 'welcome_tpl_edit_text_';
const welcomeTemplateStartEditMediaPrefix = 'welcome_tpl_edit_media_';
const welcomeTemplateStartPreviewPrefix = 'welcome_tpl_preview_';
const welcomeTemplateStartTogglePrefix = 'welcome_tpl_toggle_';
const welcomeTemplateStartDeleteConfirmPrefix = 'welcome_tpl_delete_confirm_';
const welcomeTemplateStartDeletePrefix = 'welcome_tpl_delete_';
const membershipUserDetailPrefix = 'membership_user:detail:';
const membershipRevokeSelectPrefix = 'membership_revoke:select:';
const membershipRevokeConfirmCallback = 'membership_revoke:confirm';
const membershipRevokeCancelCallback = 'membership_revoke:cancel';
const activeHelpSections = new Map<string, TelegramHelpSection>();
const featureStatusDocumentPath = resolve(process.cwd(), 'docs', 'feature-status.md');
type CommonLabels = ReturnType<typeof createTelegramI18n>['common'];

export function registerHandlers({
  bot,
  publicName,
  adminElevationPasswordHash,
}: {
  bot: TelegramBotLike;
  publicName: string;
  adminElevationPasswordHash: string;
}): void {
  registerTelegramCommands({
    bot,
    commands: createDefaultCommands({
      publicName,
      adminElevationPasswordHash,
    }),
  });

  registerMembershipCallbacks({ bot, publicName, adminElevationPasswordHash });
  registerWelcomeTemplateAdminCallbacks({ bot });
  registerScheduleCallbacks({ bot });
  registerGroupPurchaseCallbacks({ bot });
  registerLfgCallbacks({ bot });
  registerNoticeCallbacks({ bot });
  registerNewsGroupCallbacks({ bot });
  registerTableReadCallbacks({ bot });
  registerTableAdminCallbacks({ bot });
  registerCatalogReadCallbacks({ bot });
  registerCatalogAdminCallbacks({ bot });
  registerStorageCallbacks({ bot });
  registerVenueEventAdminCallbacks({ bot });
  registerTextHandlers({ bot, publicName, adminElevationPasswordHash });
  registerMessageHandlers({ bot });
}

function registerTextHandlers({
  bot,
  publicName,
  adminElevationPasswordHash,
}: {
  bot: TelegramBotLike;
  publicName: string;
  adminElevationPasswordHash: string;
}): void {
  bot.onText(async (context) => {
    await recordCurrentMenuActionSelection(context);
    const text = context.messageText?.trim();

    if (text && matchesActionMenuLabel(text, 'start')) {
      clearActiveHelpSection(context);
    }

    if (await handleTelegramLanguageText(context)) {
      return;
    }

    if (await handleTelegramActionMenuText(context, { publicName, adminElevationPasswordHash })) {
      return;
    }

    if (await handleTelegramMemberMenuDebugText(context)) {
      return;
    }

    if (await handleWelcomeTemplateAdminText(context)) {
      return;
    }

    if (await handleSecretWelcomePreviewText(context)) {
      return;
    }

    if (await handleMembershipDisplayNameText(context)) {
      return;
    }

    if (await handlePrivateAutoMembershipRequest(context)) {
      return;
    }

    if (context.isForwardedMessage && await handleTelegramStorageMessage(context)) {
      setActiveHelpSection(context, 'storage');
      return;
    }

    if (await handleTelegramCatalogLoanText(context)) {
      return;
    }

    if (await handleTelegramStorageText(context)) {
      setActiveHelpSection(context, 'storage');
      return;
    }

    if (await handleTelegramGroupPurchaseText(context)) {
      setActiveHelpSection(context, 'group_purchases');
      return;
    }

    if (await handleTelegramLfgText(context)) {
      setActiveHelpSection(context, 'lfg');
      return;
    }

    if (await handleTelegramNoticeText(context)) {
      setActiveHelpSection(context, 'notices');
      return;
    }

    if (await handleTelegramVenueEventAdminText(context)) {
      return;
    }

    if (await handleTelegramCalendarText(context)) {
      return;
    }

    if (await handleTelegramScheduleText(context)) {
      setActiveHelpSection(context, 'schedule');
      return;
    }

    if (await handleTelegramTableAdminText(context)) {
      return;
    }

    if (await handleTelegramCatalogAdminText(context)) {
      setActiveHelpSection(context, 'catalog');
      return;
    }

    if (await handleTelegramCatalogReadText(context)) {
      setActiveHelpSection(context, 'catalog');
      return;
    }
  });
}

function registerMessageHandlers({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onMessage?.(async (context) => {
    if (await handleMembershipAutojoinNewMembers(context)) {
      return;
    }

    if (await handleWelcomeTemplateAdminMessage(context)) {
      return;
    }

    if (await handleWelcomeAnimationFileIdLookup(context)) {
      return;
    }

    if (await handleTelegramCatalogAdminMessage(context)) {
      return;
    }

    if (await handleTelegramScheduleMessage(context)) {
      return;
    }

    if (await handleTelegramNoticeMessage(context)) {
      return;
    }

    await handleTelegramStorageMessage(context);
  });
}

function registerNoticeCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(noticeCallbackPrefixes.archiveConfirm, async (context) => {
    await handleTelegramNoticeCallback(context);
  });
  bot.onCallback(noticeCallbackPrefixes.archive, async (context) => {
    await handleTelegramNoticeCallback(context);
  });
}

function registerWelcomeTemplateAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(welcomeTemplateCreateCallback, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await startWelcomeTemplateCreateFlow(context);
  });
  bot.onCallback(welcomeTemplateListPagePrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await sendWelcomeTemplatesAdminList(context, parseWelcomeTemplatePageCallback(context.callbackData));
  });
  bot.onCallback(welcomeTemplateDetailPrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await sendWelcomeTemplateAdminDetail(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateDetailPrefix));
  });
  bot.onCallback(welcomeTemplateEditTextPrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await startWelcomeTemplateEditTextFlow(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateEditTextPrefix));
  });
  bot.onCallback(welcomeTemplateEditMediaPrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await startWelcomeTemplateEditMediaFlow(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateEditMediaPrefix));
  });
  bot.onCallback(welcomeTemplateTogglePrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    const template = await loadWelcomeTemplateForAdminCallback(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateTogglePrefix));
    if (!template) {
      return;
    }
    await updateWelcomeTemplateFromTelegram(context, {
      templateId: template.id,
      isEnabled: !template.isEnabled,
    });
  });
  bot.onCallback(welcomeTemplateDeleteConfirmPrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await sendWelcomeTemplateDeleteConfirmation(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateDeleteConfirmPrefix));
  });
  bot.onCallback(welcomeTemplateDeletePrefix, async (context) => {
    if (!(await ensureWelcomeTemplateAdminCallback(context))) {
      return;
    }
    await deleteWelcomeTemplateFromTelegram(context, parseWelcomeTemplateIdCallback(context.callbackData, welcomeTemplateDeletePrefix));
  });
}

async function handleWelcomeTemplateAdminStartPayload(
  context: TelegramCommandHandlerContext,
  startPayload: string | undefined,
): Promise<boolean> {
  if (!startPayload?.startsWith('welcome_tpl_')) {
    return false;
  }
  if (!(await ensureWelcomeTemplateAdminCallback(context))) {
    return true;
  }

  if (startPayload === welcomeTemplateStartCreatePayload) {
    await startWelcomeTemplateCreateFlow(context);
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartListPrefix)) {
    await sendWelcomeTemplatesAdminList(context, parseWelcomeTemplateStartPage(startPayload));
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartDetailPrefix)) {
    await sendWelcomeTemplateAdminDetail(context, parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartDetailPrefix));
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartEditTextPrefix)) {
    await startWelcomeTemplateEditTextFlow(context, parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartEditTextPrefix));
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartEditMediaPrefix)) {
    await startWelcomeTemplateEditMediaFlow(context, parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartEditMediaPrefix));
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartPreviewPrefix)) {
    await sendSecretWelcomePreview(context, {
      templateId: parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartPreviewPrefix),
    });
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartTogglePrefix)) {
    const template = await loadWelcomeTemplateForAdminCallback(
      context,
      parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartTogglePrefix),
    );
    if (template) {
      await updateWelcomeTemplateFromTelegram(context, {
        templateId: template.id,
        isEnabled: !template.isEnabled,
      });
    }
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartDeleteConfirmPrefix)) {
    await sendWelcomeTemplateDeleteConfirmation(
      context,
      parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartDeleteConfirmPrefix),
    );
    return true;
  }

  if (startPayload.startsWith(welcomeTemplateStartDeletePrefix)) {
    await deleteWelcomeTemplateFromTelegram(context, parseWelcomeTemplateStartId(startPayload, welcomeTemplateStartDeletePrefix));
    return true;
  }

  return false;
}

async function handleWelcomeTemplatesAdminMenu(context: TelegramCommandHandlerContext): Promise<void> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    await context.reply(createTelegramI18n(context.runtime.bot.language ?? 'ca').common.accessDeniedAdmin);
    return;
  }

  await context.runtime.session.cancel();
  await sendWelcomeTemplatesAdminList(context, 1);
}

async function sendWelcomeTemplatesAdminList(context: TelegramCommandHandlerContext, page: number): Promise<void> {
  const store = getWelcomeTemplateStore(context);
  const templates = await store.listTemplates();
  const currentPage = clampWelcomeTemplatePage(page, templates.length);
  await context.runtime.session.start({
    flowKey: welcomeTemplateAdminFlowKey,
    stepKey: 'list',
    data: { page: currentPage },
  });
  const labels = createTelegramI18n(context.runtime.bot.language ?? 'ca').common;
  await context.reply(
    formatWelcomeTemplatesAdminMenu({
      templates,
      labels,
      page: currentPage,
    }),
    {
      parseMode: 'HTML',
      replyKeyboard: buildWelcomeTemplatesAdminReplyKeyboard({
        labels,
        currentPage,
        totalPages: calculateWelcomeTemplateTotalPages(templates.length),
      }),
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  );
}

async function handleWelcomeTemplateAdminText(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const text = context.messageText?.trim();
  if (!text) {
    return false;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const session = context.runtime.session.current;

  if (!session && matchesCommonLabel(text, 'backToStartButton')) {
    return replyWithStartAndDefaultKeyboard(context);
  }

  if (matchesCommonLabel(text, 'welcomeTemplatesCreateButton')) {
    await startWelcomeTemplateCreateFlow(context);
    return true;
  }

  if (session?.flowKey !== welcomeTemplateAdminFlowKey) {
    return false;
  }

  if (session.stepKey === 'list') {
    const currentPage = typeof session.data.page === 'number' ? session.data.page : 1;
    if (matchesCommonLabel(text, 'welcomeTemplatesPrevPageButton')) {
      await sendWelcomeTemplatesAdminList(context, currentPage - 1);
      return true;
    }
    if (matchesCommonLabel(text, 'welcomeTemplatesNextPageButton')) {
      await sendWelcomeTemplatesAdminList(context, currentPage + 1);
      return true;
    }
    if (matchesCommonLabel(text, 'backToStartButton')) {
      return replyWithStartAndDefaultKeyboard(context);
    }
    return false;
  }

  if (session.stepKey === 'template-text') {
    const templateText = text.trim();
    if (!templateText) {
      await context.reply(i18n.common.welcomeTemplatesInvalidText);
      return true;
    }

    await context.runtime.session.advance({
      stepKey: 'animation',
      data: {
        templateText,
        templateHtml: renderTelegramMessageTextAsHtml(templateText, context.messageEntities),
      },
    });
    await context.reply(i18n.common.welcomeTemplatesGifPrompt, {
      replyKeyboard: [[i18n.common.welcomeTemplatesSkipGifButton], ['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  if (session.stepKey === 'animation') {
    if (matchesCommonLabel(text, 'welcomeTemplatesSkipGifButton')) {
      const templateText = typeof session.data.templateText === 'string' ? session.data.templateText : '';
      await saveWelcomeTemplateFromTelegram(context, {
        templateText,
        templateHtml: typeof session.data.templateHtml === 'string' ? session.data.templateHtml : null,
      });
      return true;
    }

    await context.reply(i18n.common.welcomeTemplatesInvalidGif, {
      replyKeyboard: [[i18n.common.welcomeTemplatesSkipGifButton], ['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  if (session.stepKey === 'edit-text') {
    const templateText = text.trim();
    if (!templateText) {
      await context.reply(i18n.common.welcomeTemplatesInvalidText);
      return true;
    }

    await updateWelcomeTemplateFromTelegram(context, {
      templateId: getSessionString(session.data, 'templateId'),
      templateText,
      templateHtml: renderTelegramMessageTextAsHtml(templateText, context.messageEntities),
    });
    return true;
  }

  if (session.stepKey === 'edit-media') {
    if (matchesCommonLabel(text, 'welcomeTemplatesSkipGifButton')) {
      await updateWelcomeTemplateFromTelegram(context, {
        templateId: getSessionString(session.data, 'templateId'),
        animationFileId: null,
      });
      return true;
    }

    await context.reply(i18n.common.welcomeTemplatesInvalidGif, {
      replyKeyboard: [[i18n.common.welcomeTemplatesSkipGifButton], ['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  return false;
}

async function handleWelcomeTemplateAdminMessage(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const session = context.runtime.session.current;
  if (session?.flowKey !== welcomeTemplateAdminFlowKey || !['animation', 'edit-media'].includes(session.stepKey)) {
    return false;
  }

  const media = context.messageMedia;
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  if (!isWelcomeGifAttachment(media)) {
    await context.reply(i18n.common.welcomeTemplatesInvalidGif, {
      replyKeyboard: [[i18n.common.welcomeTemplatesSkipGifButton], ['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  if (session.stepKey === 'edit-media') {
    await updateWelcomeTemplateFromTelegram(context, {
      templateId: getSessionString(session.data, 'templateId'),
      animationFileId: media.fileId,
    });
  } else {
    const templateText = typeof session.data.templateText === 'string' ? session.data.templateText : '';
    await saveWelcomeTemplateFromTelegram(context, {
      templateText,
      templateHtml: typeof session.data.templateHtml === 'string' ? session.data.templateHtml : null,
      animationFileId: media.fileId,
    });
  }
  return true;
}

async function startWelcomeTemplateCreateFlow(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  await context.runtime.session.start({
    flowKey: welcomeTemplateAdminFlowKey,
    stepKey: 'template-text',
    data: {},
  });
  await context.reply(i18n.common.welcomeTemplatesTextPrompt, {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
}

async function saveWelcomeTemplateFromTelegram(
  context: TelegramCommandHandlerContext,
  input: {
    templateText: string;
    templateHtml?: string | null;
    animationFileId?: string;
  },
): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const templateText = input.templateText.trim();
  if (!templateText) {
    await context.reply(i18n.common.welcomeTemplatesInvalidText);
    return;
  }

  const store = getWelcomeTemplateStore(context);
  const existingTemplates = await store.listTemplates();
  await store.saveTemplate({
    templateText,
    templateHtml: input.templateHtml ?? null,
    animationFileId: input.animationFileId ?? null,
    targetTelegramUserId: null,
    isEnabled: true,
    sortOrder: existingTemplates.length,
  });
  await context.runtime.session.cancel();
  await context.reply(i18n.common.welcomeTemplatesCreated, await buildReplyOptionsForCurrentActionMenu(context));
  await sendWelcomeTemplatesAdminList(context, calculateWelcomeTemplateTotalPages(existingTemplates.length + 1));
}

async function updateWelcomeTemplateFromTelegram(
  context: TelegramCommandHandlerContext,
  input: {
    templateId: string;
    templateText?: string;
    templateHtml?: string | null;
    animationFileId?: string | null;
    isEnabled?: boolean;
  },
): Promise<WelcomeMessageTemplate | null> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const store = getWelcomeTemplateStore(context);
  const existing = (await store.listTemplates()).find((template) => template.id === input.templateId);
  if (!existing) {
    await context.runtime.session.cancel();
    await context.reply(i18n.common.welcomeTemplatesTargetMissing, await buildReplyOptionsForCurrentActionMenu(context));
    return null;
  }

  const updated = await store.saveTemplate({
    ...existing,
    ...(input.templateText !== undefined ? { templateText: input.templateText } : {}),
    ...(input.templateHtml !== undefined ? { templateHtml: input.templateHtml } : {}),
    ...(input.animationFileId !== undefined ? { animationFileId: input.animationFileId } : {}),
    ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
  });
  await context.runtime.session.cancel();
  await context.reply(i18n.common.welcomeTemplatesUpdated, await buildReplyOptionsForCurrentActionMenu(context));
  await sendWelcomeTemplateAdminDetail(context, updated.id);
  return updated;
}

async function startWelcomeTemplateEditTextFlow(context: TelegramCommandHandlerContext, templateId: string): Promise<void> {
  const template = await loadWelcomeTemplateForAdminCallback(context, templateId);
  if (!template) {
    return;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  await context.runtime.session.start({
    flowKey: welcomeTemplateAdminFlowKey,
    stepKey: 'edit-text',
    data: { templateId },
  });
  await context.reply(`${formatWelcomeTemplateAdminDetail(template)}\n\n${escapeHtml(i18n.common.welcomeTemplatesEditTextPrompt)}`, {
    parseMode: 'HTML',
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
}

async function startWelcomeTemplateEditMediaFlow(context: TelegramCommandHandlerContext, templateId: string): Promise<void> {
  const template = await loadWelcomeTemplateForAdminCallback(context, templateId);
  if (!template) {
    return;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  await context.runtime.session.start({
    flowKey: welcomeTemplateAdminFlowKey,
    stepKey: 'edit-media',
    data: { templateId },
  });
  await context.reply(`${formatWelcomeTemplateAdminDetail(template)}\n\n${escapeHtml(i18n.common.welcomeTemplatesEditMediaPrompt)}`, {
    parseMode: 'HTML',
    replyKeyboard: [[i18n.common.welcomeTemplatesSkipGifButton], ['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
}

async function sendWelcomeTemplateAdminDetail(context: TelegramCommandHandlerContext, templateId: string): Promise<void> {
  const template = await loadWelcomeTemplateForAdminCallback(context, templateId);
  if (!template) {
    return;
  }

  await context.reply(formatWelcomeTemplateAdminDetailMessage(context, template), { parseMode: 'HTML' });
}

async function sendWelcomeTemplateDeleteConfirmation(context: TelegramCommandHandlerContext, templateId: string): Promise<void> {
  const template = await loadWelcomeTemplateForAdminCallback(context, templateId);
  if (!template) {
    return;
  }

  const labels = createTelegramI18n(context.runtime.bot.language ?? 'ca').common;
  const confirmLink = buildWelcomeTemplateHtmlLink(
    `${welcomeTemplateStartDeletePrefix}${template.id}`,
    labels.welcomeTemplatesDeleteConfirmButton,
    true,
  );
  const backLink = buildWelcomeTemplateHtmlLink(
    `${welcomeTemplateStartDetailPrefix}${template.id}`,
    labels.welcomeTemplatesBackToListButton,
  );
  await context.reply(
    `${formatWelcomeTemplateAdminDetail(template)}\n\n${escapeHtml(labels.welcomeTemplatesDeletePrompt)}\n${confirmLink} · ${backLink}`,
    { parseMode: 'HTML' },
  );
}

async function deleteWelcomeTemplateFromTelegram(context: TelegramCommandHandlerContext, templateId: string): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const store = getWelcomeTemplateStore(context);
  const deleted = await store.deleteTemplate(templateId);
  await context.runtime.session.cancel();
  await context.reply(
    deleted ? i18n.common.welcomeTemplatesDeleted : i18n.common.welcomeTemplatesTargetMissing,
    await buildReplyOptionsForCurrentActionMenu(context),
  );
  await sendWelcomeTemplatesAdminList(context, 1);
}

async function loadWelcomeTemplateForAdminCallback(
  context: TelegramCommandHandlerContext,
  templateId: string,
): Promise<WelcomeMessageTemplate | null> {
  const template = (await getWelcomeTemplateStore(context).listTemplates()).find((candidate) => candidate.id === templateId);
  if (!template) {
    await context.reply(createTelegramI18n(context.runtime.bot.language ?? 'ca').common.welcomeTemplatesTargetMissing);
    return null;
  }
  return template;
}

async function ensureWelcomeTemplateAdminCallback(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
    return true;
  }

  await context.reply(createTelegramI18n(context.runtime.bot.language ?? 'ca').common.accessDeniedAdmin);
  return false;
}

function getWelcomeTemplateStore(context: TelegramCommandHandlerContext) {
  return createAppMetadataWelcomeTemplateStore({ storage: getWelcomeTemplateStorage(context) });
}

function getWelcomeTemplateStorage(context: TelegramCommandHandlerContext) {
  return createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
}

function formatWelcomeTemplateAdminDetail(template: WelcomeMessageTemplate): string {
  const lines = [
    `ID: ${escapeHtml(template.id)}`,
    `Estado: ${template.isEnabled ? 'activa' : 'desactivada'}`,
    `Adjunto: ${template.animationFileId ? 'sí' : 'no'}`,
    `Usuario objetivo: ${escapeHtml(template.targetTelegramUserId ? String(template.targetTelegramUserId) : 'global')}`,
    '',
    escapeHtml(template.templateText),
  ];
  return lines.join('\n');
}

function formatWelcomeTemplateAdminDetailMessage(
  context: TelegramCommandHandlerContext,
  template: WelcomeMessageTemplate,
): string {
  const labels = createTelegramI18n(context.runtime.bot.language ?? 'ca').common;
  return [
    formatWelcomeTemplateAdminDetail(template),
    '',
    [
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartEditTextPrefix}${template.id}`, labels.welcomeTemplatesEditTextButton),
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartEditMediaPrefix}${template.id}`, labels.welcomeTemplatesEditMediaButton),
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartPreviewPrefix}${template.id}`, labels.welcomeTemplatesPreviewButton),
    ].join(' · '),
    [
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartTogglePrefix}${template.id}`, labels.welcomeTemplatesToggleEnabledButton),
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartDeleteConfirmPrefix}${template.id}`, labels.welcomeTemplatesDeleteButton, true),
    ].join(' · '),
  ].join('\n');
}

function formatWelcomeTemplatesAdminMenu({
  templates,
  labels,
  page = 1,
}: {
  templates: WelcomeMessageTemplate[];
  labels: CommonLabels;
  page?: number;
}): string {
  if (templates.length === 0) {
    return escapeHtml(labels.welcomeTemplatesEmpty);
  }

  const currentPage = clampWelcomeTemplatePage(page, templates.length);
  const totalPages = calculateWelcomeTemplateTotalPages(templates.length);
  const startIndex = (currentPage - 1) * welcomeTemplateAdminPageSize;
  const pageTemplates = templates.slice(startIndex, startIndex + welcomeTemplateAdminPageSize);
  const lines: string[] = [
    escapeHtml(labels.welcomeTemplatesIntro),
    '',
  ];
  for (const [index, template] of pageTemplates.entries()) {
    const label = `${startIndex + index + 1}. ${truncateWelcomeTemplateText(template.templateText)}`;
    const target = template.targetTelegramUserId ? ` -> ${template.targetTelegramUserId}` : '';
    const gif = template.animationFileId ? ' + GIF' : '';
    const status = template.isEnabled ? '' : ' (off)';
    lines.push([
      escapeHtml(label),
      buildWelcomeTemplateHtmlLink(`${welcomeTemplateStartDetailPrefix}${template.id}`, labels.welcomeTemplatesDetailButton),
      escapeHtml(`${gif}${target}${status}`),
    ].join(' '));
  }

  if (totalPages > 1) {
    lines.push('');
    lines.push(escapeHtml(formatWelcomeTemplatePageFooter({
      labels,
      shownFrom: startIndex + 1,
      shownTo: startIndex + pageTemplates.length,
      total: templates.length,
      page: currentPage,
      totalPages,
    })));
  }

  return lines.join('\n');
}

function formatWelcomeTemplatePageFooter({
  labels,
  shownFrom,
  shownTo,
  total,
  page,
  totalPages,
}: {
  labels: CommonLabels;
  shownFrom: number;
  shownTo: number;
  total: number;
  page: number;
  totalPages: number;
}): string {
  return labels.welcomeTemplatesPageFooter
    .replace('{from}', String(shownFrom))
    .replace('{to}', String(shownTo))
    .replace('{total}', String(total))
    .replace('{page}', String(page))
    .replace('{pages}', String(totalPages));
}

function buildWelcomeTemplatesAdminReplyKeyboard({
  labels,
  currentPage,
  totalPages,
}: {
  labels: CommonLabels;
  currentPage: number;
  totalPages: number;
}): string[][] {
  const rows: string[][] = [];
  const navigation = [
    ...(currentPage > 1 ? [labels.welcomeTemplatesPrevPageButton] : []),
    ...(currentPage < totalPages ? [labels.welcomeTemplatesNextPageButton] : []),
  ];
  if (navigation.length > 0) {
    rows.push(navigation);
  }
  rows.push([labels.welcomeTemplatesCreateButton]);
  rows.push([labels.backToStartButton]);
  return rows;
}

function buildWelcomeTemplateHtmlLink(payload: string, label: string, bold = false): string {
  const text = bold ? `<b>${escapeHtml(label)}</b>` : escapeHtml(label);
  return `<a href="${escapeHtml(buildTelegramStartUrl(payload))}">${text}</a>`;
}

function truncateWelcomeTemplateText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}

function calculateWelcomeTemplateTotalPages(totalItems: number): number {
  return Math.max(1, Math.ceil(totalItems / welcomeTemplateAdminPageSize));
}

function clampWelcomeTemplatePage(page: number, totalItems: number): number {
  const parsed = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(parsed, 1), calculateWelcomeTemplateTotalPages(totalItems));
}

function parseWelcomeTemplatePageCallback(callbackData: string | undefined): number {
  const parsed = Number(callbackData?.slice(welcomeTemplateListPagePrefix.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
}

function parseWelcomeTemplateStartPage(startPayload: string): number {
  const parsed = Number(startPayload.slice(welcomeTemplateStartListPrefix.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 1;
}

function parseWelcomeTemplateIdCallback(callbackData: string | undefined, prefix: string): string {
  return callbackData?.slice(prefix.length).trim() ?? '';
}

function parseWelcomeTemplateStartId(startPayload: string, prefix: string): string {
  return startPayload.slice(prefix.length).trim();
}

async function handleSecretWelcomePreviewText(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (
    context.runtime.chat.kind !== 'private' ||
    context.runtime.session.current ||
    !isSecretWelcomePreviewText(context.messageText)
  ) {
    return false;
  }

  await sendSecretWelcomePreview(context);
  return true;
}

function isSecretWelcomePreviewText(text: string | undefined): boolean {
  const normalized = text?.trim().toLowerCase();
  return normalized === 'welcome' || normalized === 'bienvenida';
}

async function sendSecretWelcomePreview(
  context: TelegramCommandHandlerContext,
  input: {
    requestedIndex?: number | null;
    templateId?: string | null;
  } = {},
): Promise<void> {
  const storage = getWelcomeTemplateStorage(context);
  const templateStore = createAppMetadataWelcomeTemplateStore({ storage });
  const template = input.templateId
    ? (await templateStore.listTemplates()).find((candidate) => candidate.id === input.templateId) ?? null
    : input.requestedIndex
    ? await pickWelcomeTemplateByUserVisibleIndex({
      templateStore,
      telegramUserId: context.runtime.actor.telegramUserId,
      requestedIndex: input.requestedIndex,
    })
    : await pickRememberedRandomWelcomeTemplate({
      storage,
      templateStore,
      telegramUserId: context.runtime.actor.telegramUserId,
    });
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  if (!template) {
    await context.reply(i18n.common.welcomePreviewNoTemplates);
    return;
  }

  const membershipRepository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const existingUser = await membershipRepository.findUserByTelegramUserId(context.runtime.actor.telegramUserId);
  const displayName = existingUser?.displayName ?? resolveRequesterDisplayName(context);
  await sendWelcomeTemplateToCurrentChat(context, {
    template,
    message: renderWelcomeTemplate(template.templateText, displayName),
    htmlMessage: renderWelcomeTemplateHtml(template, displayName),
  });
}

async function pickWelcomeTemplateByUserVisibleIndex({
  templateStore,
  telegramUserId,
  requestedIndex,
}: {
  templateStore: ReturnType<typeof createAppMetadataWelcomeTemplateStore>;
  telegramUserId: number;
  requestedIndex: number;
}): Promise<WelcomeMessageTemplate | null> {
  const templates = (await templateStore.listTemplates())
    .filter((template) => template.isEnabled)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const targeted = templates.filter((template) => template.targetTelegramUserId === telegramUserId);
  const candidates = targeted.length > 0 ? targeted : templates.filter((template) => template.targetTelegramUserId == null);
  return candidates[requestedIndex - 1] ?? null;
}

async function pickRememberedRandomWelcomeTemplate({
  storage,
  templateStore,
  telegramUserId,
}: {
  storage: ReturnType<typeof createDatabaseAppMetadataSessionStorage>;
  templateStore: ReturnType<typeof createAppMetadataWelcomeTemplateStore>;
  telegramUserId: number;
}): Promise<WelcomeMessageTemplate | null> {
  const lastPickedKey = `${welcomeTemplateLastPickedPrefix}${telegramUserId}`;
  const lastPickedTemplateId = await storage.get(lastPickedKey);
  const template = await templateStore.pickTemplate({
    telegramUserId,
    excludeTemplateId: lastPickedTemplateId,
  });
  if (template) {
    await storage.set(lastPickedKey, template.id);
  }
  return template;
}

async function handleWelcomeAnimationFileIdLookup(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }
  const media = context.messageMedia;
  if (!isWelcomeGifAttachment(media)) {
    return false;
  }

  await context.reply(`GIF detectado. Usa este Telegram animation file ID en /admin/welcome:\n${media.fileId}`);
  return true;
}

function isWelcomeGifAttachment(media: TelegramCommandHandlerContext['messageMedia']): media is NonNullable<TelegramCommandHandlerContext['messageMedia']> & { fileId: string } {
  if (!media?.fileId) {
    return false;
  }

  if (media.attachmentKind === 'animation' || media.attachmentKind === 'video') {
    return true;
  }

  if (media.attachmentKind !== 'document') {
    return false;
  }

  const mimeType = media.mimeType?.toLowerCase() ?? '';
  const fileName = media.originalFileName?.toLowerCase() ?? '';
  return mimeType === 'image/gif' || fileName.endsWith('.gif');
}

async function sendWelcomeTemplateToCurrentChat(
  context: TelegramCommandHandlerContext,
  {
    template,
    message,
    htmlMessage,
  }: {
    template: WelcomeMessageTemplate;
    message: string;
    htmlMessage: string;
  },
): Promise<void> {
  if (context.runtime.chat.kind !== 'private') {
    await sendWelcomeTemplateToGroupChat(context, context.runtime.chat.chatId, {
      template,
      htmlMessage,
      messageThreadId: context.messageThreadId ?? null,
    });
    return;
  }

  if (template.animationFileId && context.runtime.bot.sendAnimation) {
    await context.runtime.bot.sendAnimation({
      chatId: context.runtime.chat.chatId,
      animationFileId: template.animationFileId,
      ...(htmlMessage.length <= 1000 ? { caption: htmlMessage, options: { parseMode: 'HTML' as const } } : {}),
      ...(context.messageThreadId ? { messageThreadId: context.messageThreadId } : {}),
    });
    if (htmlMessage.length > 1000) {
      if (context.runtime.chat.kind === 'private') {
        await context.reply(htmlMessage, { parseMode: 'HTML' });
      } else if (context.runtime.bot.sendGroupMessage) {
        await context.runtime.bot.sendGroupMessage(context.runtime.chat.chatId, htmlMessage, {
          parseMode: 'HTML',
          ...(context.messageThreadId ? { messageThreadId: context.messageThreadId } : {}),
        });
      }
    }
    return;
  }
  await context.reply(htmlMessage, { parseMode: 'HTML' });
}

async function sendWelcomeTemplateToGroupChat(
  context: TelegramCommandHandlerContext,
  chatId: number,
  {
    template,
    htmlMessage,
    messageThreadId,
  }: {
    template: WelcomeMessageTemplate;
    htmlMessage: string;
    messageThreadId?: number | null;
  },
): Promise<void> {
  if (template.animationFileId && context.runtime.bot.sendAnimation) {
    await context.runtime.bot.sendAnimation({
      chatId,
      animationFileId: template.animationFileId,
      ...(htmlMessage.length <= 1000 ? { caption: htmlMessage, options: { parseMode: 'HTML' as const } } : {}),
      ...(messageThreadId ? { messageThreadId } : {}),
    });
    if (htmlMessage.length <= 1000) {
      return;
    }
  }

  if (context.runtime.bot.sendGroupMessage) {
    await context.runtime.bot.sendGroupMessage(chatId, htmlMessage, {
      parseMode: 'HTML',
      ...(messageThreadId ? { messageThreadId } : {}),
    });
  }
}

function registerGroupPurchaseCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const prefix of Object.values(groupPurchaseCallbackPrefixes)) {
    bot.onCallback(prefix, async (context) => {
      await handleTelegramGroupPurchaseCallback(context);
    });
  }
}

function registerLfgCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const prefix of Object.values(lfgCallbackPrefixes)) {
    bot.onCallback(prefix, async (context) => {
      await handleTelegramLfgCallback(context);
    });
  }
}

function registerNewsGroupCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const prefix of Object.values(newsGroupCallbackPrefixes)) {
    bot.onCallback(prefix, async (context) => {
      await handleTelegramNewsGroupCallback(context);
    });
  }
}

function createDefaultCommands({
  publicName,
  adminElevationPasswordHash,
}: {
  publicName: string;
  adminElevationPasswordHash: string;
}): TelegramCommandDefinition[] {
  return [
    {
      command: 'elevate_admin',
      contexts: ['private'],
      access: 'public',
      description: 'Eleva privilegis amb contrasenya',
      handle: async (context) => {
        const password = parseCommandSecret(context.messageText, 'elevate_admin', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseAdminElevationRepository({
          database: context.runtime.services.database.db,
        });
        const result = await elevateApprovedUserToAdmin({
          repository,
          telegramUserId: context.runtime.actor.telegramUserId,
          password,
          passwordHash: adminElevationPasswordHash,
        });

        await context.reply(result.message);
      },
    },
    {
      command: 'access',
      contexts: ['private'],
      access: 'public',
      description: 'Sollicita accés al club',
      handle: async (context) => {
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const existing = await repository.findUserByTelegramUserId(context.runtime.actor.telegramUserId);
        if (!existing || existing.status === 'revoked') {
          await startMembershipAccessDisplayNameFlow(context);
          return;
        }

        await submitMembershipAccessRequest(context, existing.displayName);
      },
    },
    {
      command: 'subscribe_requests',
      contexts: ['private'],
      access: 'admin',
      descriptionByLanguage: {
        ca: "Activa avisos privats de noves sol·licituds d'accés",
        es: 'Activa avisos privados de nuevas solicitudes de acceso',
        en: 'Enable private alerts for new access requests',
      },
      handle: async (context) => {
        const storage = createDatabaseAppMetadataSessionStorage({
          database: context.runtime.services.database.db,
        });
        const subscriptionStore = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });
        const result = await toggleMembershipRequestNotifications({
          store: subscriptionStore,
          telegramUserId: context.runtime.actor.telegramUserId,
          enabled: true,
        });
        const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');

        await context.reply(
          result === 'enabled' ? i18n.membership.requestNotificationsEnabled : i18n.membership.requestNotificationsAlreadyEnabled,
        );
      },
    },
    {
      command: 'unsubscribe_requests',
      contexts: ['private'],
      access: 'admin',
      descriptionByLanguage: {
        ca: "Desactiva avisos privats de noves sol·licituds d'accés",
        es: 'Desactiva avisos privados de nuevas solicitudes de acceso',
        en: 'Disable private alerts for new access requests',
      },
      handle: async (context) => {
        const storage = createDatabaseAppMetadataSessionStorage({
          database: context.runtime.services.database.db,
        });
        const subscriptionStore = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });
        const result = await toggleMembershipRequestNotifications({
          store: subscriptionStore,
          telegramUserId: context.runtime.actor.telegramUserId,
          enabled: false,
        });
        const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');

        await context.reply(
          result === 'disabled' ? i18n.membership.requestNotificationsDisabled : i18n.membership.requestNotificationsAlreadyDisabled,
        );
      },
    },
    {
      command: 'language',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Canvia l idioma del bot',
      handle: async (context) => {
        await handleTelegramLanguageCommand(context);
      },
    },
    {
      command: 'schedule',
      contexts: ['private'],
      access: 'approved',
      description: 'Gestiona les teves activitats del club',
      handle: async (context) => {
        await handleTelegramScheduleText({ ...context, messageText: '/schedule' });
      },
    },
    {
      command: 'calendar',
      contexts: ['private'],
      access: 'approved',
      handle: async (context) => {
        await handleTelegramCalendarText({ ...context, messageText: '/calendar' });
      },
    },
    {
      command: 'tables',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta les taules actives del club',
      handle: async (context) => {
        await handleTelegramTableReadCommand(context);
      },
    },
    {
      command: 'catalog_search',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta i cerca el catàleg',
      handle: async (context) => {
        await handleTelegramCatalogReadCommand(context);
      },
    },
    {
      command: 'group_purchases',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta les compres conjuntes del club',
      handle: async (context) => {
        await handleTelegramGroupPurchaseCommand(context);
      },
    },
    {
      command: 'lfg',
      contexts: ['private'],
      access: 'approved',
      descriptionByLanguage: {
        ca: 'Troba grup o jugadors per jugar',
        es: 'Encuentra grupo o jugadores para jugar',
        en: 'Find a group or players to play',
      },
      handle: async (context) => {
        await handleTelegramLfgCommand(context);
      },
    },
    {
      command: 'notices',
      contexts: ['private'],
      access: 'approved',
      descriptionByLanguage: {
        ca: 'Consulta i publica avisos del club',
        es: 'Consulta y publica avisos del club',
        en: 'View and publish club notices',
      },
      handle: async (context) => {
        await handleTelegramNoticeCommand(context);
      },
    },
    {
      command: 'avisos',
      contexts: ['private'],
      access: 'approved',
      descriptionByLanguage: {
        ca: 'Consulta i publica avisos del club',
        es: 'Consulta y publica avisos del club',
        en: 'View and publish club notices',
      },
      handle: async (context) => {
        await handleTelegramNoticeCommand(context);
      },
    },
    {
      command: 'storage',
      contexts: ['private'],
      access: 'approved',
      description: 'Consulta categories i pujades d emmagatzematge',
      handle: async (context) => {
        await handleTelegramStorageCommand(context);
      },
    },
    {
      command: 'news',
      contexts: ['group', 'group-news'],
      access: 'admin',
      description: 'Gestiona el mode news i les subscripcions del grup',
      handle: async (context) => {
        await handleTelegramNewsGroupText(context);
      },
    },
    {
      command: 'autojoin',
      contexts: ['group', 'group-news'],
      access: 'admin',
      description: "Activa o desactiva l'alta automàtica de nous membres del grup",
      handle: async (context) => {
        await handleMembershipAutojoinCommand(context);
      },
    },
    {
      command: 'venue_events',
      contexts: ['private'],
      access: 'admin',
      handle: async (context) => {
        await handleTelegramVenueEventAdminText({ ...context, messageText: '/venue_events' });
      },
    },
    {
      command: 'catalog',
      contexts: ['private'],
      access: 'approved',
      description: 'Gestiona el catàleg manual del club',
      handle: async (context) => {
        await handleTelegramCatalogAdminText({ ...context, messageText: '/catalog' });
      },
    },
    {
      command: 'catalog_bulk',
      contexts: ['private'],
      access: 'approved',
      description: 'Afegeix múltiples ítems al catàleg manualment',
      handle: async (context) => {
        await handleTelegramCatalogAdminText({ ...context, messageText: '/catalog_bulk' });
      },
    },
    {
      command: 'loan_admin',
      contexts: ['private'],
      access: 'admin',
      description: 'Mostra el dashboard de préstecs actius',
      handle: async (context) => {
        await handleTelegramCatalogAdminText({ ...context, messageText: '/loan_admin' });
      },
    },
    {
      command: 'review_access',
      contexts: ['private'],
      access: 'admin',
      description: 'Revisa sol·licituds pendents',
      handle: async (context) => handleReviewAccess(context),
    },
    {
      command: 'manage_users',
      contexts: ['private'],
      access: 'admin',
      description: 'Administra i expulsa usuaris aprovats',
      handle: async (context) => handleManageUsers(context),
    },
    {
      command: 'approve',
      contexts: ['private'],
      access: 'admin',
      description: 'Aprova una sol·licitud',
      handle: async (context) => {
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'approve', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const result = await approveMembershipRequest({
          repository,
          applicantTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
        });

        await context.reply(result.adminMessage);
      },
    },
    {
      command: 'reject',
      contexts: ['private'],
      access: 'admin',
      description: 'Rebutja una sol·licitud',
      handle: async (context) => {
        const applicantTelegramUserId = parseCommandTarget(context.messageText, 'reject', context.runtime.bot.language ?? 'ca');
        const repository = createDatabaseMembershipAccessRepository({
          database: context.runtime.services.database.db,
        });
        const result = await rejectMembershipRequest({
          repository,
          applicantTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
        });

        await context.reply(result.adminMessage);
        if (result.outcome === 'blocked') {
          await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
        }
      },
    },
    {
      command: 'cancel',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Cancel.la el proces actual',
      handle: async (context) => {
        const cancelled = await context.runtime.session.cancel();
        const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');

        await context.reply(
          cancelled ? i18n.common.flowCancelled : i18n.common.noActiveFlowToCancel,
          await buildReplyOptionsForCurrentActionMenu(context),
        );
      },
    },
    {
      command: 'welcome',
      contexts: ['private'],
      access: 'public',
      handle: async (context) => {
        await sendSecretWelcomePreview(context, {
          requestedIndex: parseOptionalCommandPositiveInteger(context.messageText, 'welcome'),
        });
      },
    },
    {
      command: 'bienvenida',
      contexts: ['private'],
      access: 'public',
      handle: async (context) => {
        await sendSecretWelcomePreview(context, {
          requestedIndex: parseOptionalCommandPositiveInteger(context.messageText, 'bienvenida'),
        });
      },
    },
    {
      command: 'start',
      contexts: ['private'],
      access: 'public',
      description: 'Comprova que el bot està actiu',
      handle: async (context) => {
        const startPayload = parseStartCommandPayload(context.messageText);

        if (startPayload === 'request_access' && (await handlePrivateAutoMembershipRequest(context))) {
          return;
        }

        if (await handleWelcomeTemplateAdminStartPayload(context, startPayload)) {
          return;
        }

        const manageUserTarget = parseManageUserStartPayload(startPayload);
        if (manageUserTarget !== null) {
          await handleManageUserDetail(context, manageUserTarget);
          return;
        }

        if (await handleTelegramScheduleStartText({ ...context })) {
          return;
        }
        if (await handleTelegramTableReadStartText({ ...context })) {
          return;
        }
        if (await handleTelegramTableAdminStartText({ ...context })) {
          return;
        }
        if (await handleTelegramCatalogReadStartText({ ...context })) {
          return;
        }
        if (await handleTelegramCatalogAdminStartText({ ...context })) {
          return;
        }
        if (await handleTelegramGroupPurchaseStartText({ ...context })) {
          return;
        }
        if (await handleTelegramStorageStartText({ ...context })) {
          return;
        }
        if (await handleTelegramVenueEventAdminStartText({ ...context })) {
          return;
        }

        if (await handlePrivateAutoMembershipRequest(context)) {
          return;
        }

        await context.runtime.session.cancel();
        const startReply = await buildStartReply({
          context,
          publicName,
          version: APP_VERSION,
        });
        await context.reply(startReply.message, startReply.options);
      },
    },
    {
      command: 'status',
      contexts: ['private'],
      access: 'admin',
      descriptionByLanguage: {
        ca: "Envia l'estat actual de les funcionalitats",
        es: 'Envía el estado actual de las funcionalidades',
        en: 'Send the current feature status report',
      },
      handle: async (context) => {
        if (!existsSync(featureStatusDocumentPath)) {
          await context.reply('No encuentro el archivo de estado del proyecto en docs/feature-status.md.');
          return;
        }

        if (!context.runtime.bot.sendDocument) {
          await context.reply('No se ha podido adjuntar el estado en este momento.');
          return;
        }

        await context.runtime.bot.sendDocument({
          chatId: context.runtime.actor.telegramUserId,
          filePath: featureStatusDocumentPath,
          caption: 'Estado de funcionalidades',
        });
      },
    },
    {
      command: 'restart',
      contexts: ['private'],
      access: 'admin',
      descriptionByLanguage: {
        ca: 'Reinicia el bot i neteja estat temporal',
        es: 'Reinicia el bot y limpia estado temporal',
        en: 'Restart the bot and clear temporary state',
      },
      handle: async (context) => {
        const deletedSessions = await clearTelegramTemporaryState(context);
        await context.reply(
          [
            'Reinicio solicitado. El bot volverá a estar disponible en unos segundos.',
            `Sesiones conversacionales limpiadas: ${deletedSessions}.`,
          ].join('\n'),
        );
        scheduleProcessRestart();
      },
    },
    {
      command: 'help',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Mostra ajuda contextual',
      handle: async (context) => {
        await context.reply(
          renderTelegramHelpMessage({
            commands: createDefaultCommands({ publicName, adminElevationPasswordHash }),
            context,
            section: resolveHelpSection(context),
          }),
        );
      },
    },
  ];
}

function parseCommandTarget(
  messageText: string | undefined,
  command: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): number {
  const candidate = messageText?.trim().split(/\s+/)[1];
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError(
      createTelegramI18n(language).common.invalidTelegramUserId.replace('{command}', command),
    );
  }

  return telegramUserId;
}

function parseCommandSecret(
  messageText: string | undefined,
  command: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): string {
  const secret = messageText?.trim().split(/\s+/).slice(1).join(' ');

  if (!secret) {
    throw new TelegramInteractionError(
      createTelegramI18n(language).common.invalidPassword.replace('{command}', command),
    );
  }

  return secret;
}

function parseOptionalCommandPositiveInteger(
  messageText: string | undefined,
  command: string,
): number | null {
  const parts = messageText?.trim().split(/\s+/) ?? [];
  if (parts.length < 2) {
    return null;
  }

  const commandToken = parts[0]?.replace(/^\/+/, '').split('@')[0]?.toLowerCase();
  if (commandToken !== command.toLowerCase()) {
    return null;
  }

  const parsed = Number(parts[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCallbackTarget(
  callbackData: string | undefined,
  callbackPrefix: string,
  language: 'ca' | 'es' | 'en' = 'ca',
): number {
  const candidate = callbackData?.slice(callbackPrefix.length);
  const telegramUserId = Number(candidate);

  if (!candidate || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
    throw new TelegramInteractionError(createTelegramI18n(language).common.invalidCallbackTarget);
  }

  return telegramUserId;
}

function parseManageUserStartPayload(payload: string | null | undefined): number | null {
  const prefix = 'manage_user_';
  if (!payload?.startsWith(prefix)) {
    return null;
  }

  const telegramUserId = Number(payload.slice(prefix.length));
  return Number.isInteger(telegramUserId) && telegramUserId > 0 ? telegramUserId : null;
}

export function toGrammyReplyOptions(
  options?: TelegramReplyOptions,
  buttonAppearance?: TelegramButtonAppearanceConfig,
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  const baseOptions = {
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.messageThreadId ? { message_thread_id: options.messageThreadId } : {}),
  };

  if (!options.inlineKeyboard && !options.replyKeyboard) {
    return Object.keys(baseOptions).length > 0 ? baseOptions : undefined;
  }

  if (options.replyKeyboard) {
    return {
      reply_markup: {
        keyboard: options.replyKeyboard.map((row) => row.map((button) => toRawReplyKeyboardButton(button, buttonAppearance))),
        resize_keyboard: options.resizeKeyboard ?? true,
        is_persistent: options.persistentKeyboard ?? true,
      },
      ...baseOptions,
    };
  }

  const inlineKeyboard = options.inlineKeyboard;

  if (!inlineKeyboard) {
    return undefined;
  }

  return {
    reply_markup: {
      inline_keyboard: inlineKeyboard.map((row) =>
        row.map((button) => toRawInlineKeyboardButton(button, buttonAppearance)),
      ),
    },
    ...baseOptions,
  };
}

function toRawReplyKeyboardButton(
  button: TelegramReplyKeyboardButton,
  buttonAppearance?: TelegramButtonAppearanceConfig,
): Record<string, unknown> {
  const normalizedButton = typeof button === 'string' ? { text: button } : button;
  const appearance = normalizedButton.semanticRole ? buttonAppearance?.[normalizedButton.semanticRole] : undefined;

  return {
    text: normalizedButton.text,
    ...(normalizedButton.requestChat ? {
      request_chat: {
        request_id: normalizedButton.requestChat.requestId,
        chat_is_channel: normalizedButton.requestChat.chatIsChannel,
        ...(normalizedButton.requestChat.chatIsForum !== undefined ? { chat_is_forum: normalizedButton.requestChat.chatIsForum } : {}),
        ...(normalizedButton.requestChat.botIsMember !== undefined ? { bot_is_member: normalizedButton.requestChat.botIsMember } : {}),
        ...(normalizedButton.requestChat.userAdministratorRights ? { user_administrator_rights: toRawChatAdministratorRights(normalizedButton.requestChat.userAdministratorRights) } : {}),
        ...(normalizedButton.requestChat.botAdministratorRights ? { bot_administrator_rights: toRawChatAdministratorRights(normalizedButton.requestChat.botAdministratorRights) } : {}),
      },
    } : {}),
    ...(appearance?.style ? { style: appearance.style } : {}),
    ...(appearance?.iconCustomEmojiId ? { icon_custom_emoji_id: appearance.iconCustomEmojiId } : {}),
  };
}

function toRawChatAdministratorRights(rights: NonNullable<TelegramReplyButton['requestChat']>['botAdministratorRights']): Record<string, boolean> {
  return {
    ...(rights?.isAnonymous !== undefined ? { is_anonymous: rights.isAnonymous } : {}),
    ...(rights?.canManageChat !== undefined ? { can_manage_chat: rights.canManageChat } : {}),
    ...(rights?.canDeleteMessages !== undefined ? { can_delete_messages: rights.canDeleteMessages } : {}),
    ...(rights?.canManageVideoChats !== undefined ? { can_manage_video_chats: rights.canManageVideoChats } : {}),
    ...(rights?.canRestrictMembers !== undefined ? { can_restrict_members: rights.canRestrictMembers } : {}),
    ...(rights?.canPromoteMembers !== undefined ? { can_promote_members: rights.canPromoteMembers } : {}),
    ...(rights?.canChangeInfo !== undefined ? { can_change_info: rights.canChangeInfo } : {}),
    ...(rights?.canInviteUsers !== undefined ? { can_invite_users: rights.canInviteUsers } : {}),
    ...(rights?.canPostStories !== undefined ? { can_post_stories: rights.canPostStories } : {}),
    ...(rights?.canEditStories !== undefined ? { can_edit_stories: rights.canEditStories } : {}),
    ...(rights?.canDeleteStories !== undefined ? { can_delete_stories: rights.canDeleteStories } : {}),
    ...(rights?.canPostMessages !== undefined ? { can_post_messages: rights.canPostMessages } : {}),
    ...(rights?.canEditMessages !== undefined ? { can_edit_messages: rights.canEditMessages } : {}),
    ...(rights?.canPinMessages !== undefined ? { can_pin_messages: rights.canPinMessages } : {}),
    ...(rights?.canManageTopics !== undefined ? { can_manage_topics: rights.canManageTopics } : {}),
  };
}

function toRawInlineKeyboardButton(
  button: TelegramInlineButton,
  buttonAppearance?: TelegramButtonAppearanceConfig,
): Record<string, unknown> {
  const appearance = button.semanticRole ? buttonAppearance?.[button.semanticRole] : undefined;

  return {
    text: button.text,
    ...(button.url ? { url: button.url } : { callback_data: button.callbackData }),
    ...(appearance?.style ? { style: appearance.style } : {}),
    ...(appearance?.iconCustomEmojiId ? { icon_custom_emoji_id: appearance.iconCustomEmojiId } : {}),
  };
}

export function formatStartMessage({
  publicName,
  version,
  isAdmin,
  isApproved,
  language,
}: {
  publicName: string;
  version: string;
  isAdmin: boolean;
  isApproved: boolean;
  language: 'ca' | 'es' | 'en';
}): string {
  const i18n = createTelegramI18n(language);
  const template = isAdmin
    ? i18n.common.startMessageAdmin
    : isApproved
      ? i18n.common.startMessagePublic
      : i18n.common.startMessagePending;

  return template
    .replace('{publicName}', publicName)
    .replace('{version}', version);
}

function formatGroupStartMessage({
  publicName,
  language,
}: {
  publicName: string;
  language: 'ca' | 'es' | 'en';
}): string {
  return createTelegramI18n(language).common.startMessageGroup.replace('{publicName}', publicName);
}

async function buildStartReply({
  context,
  publicName,
  version,
}: {
  context: TelegramCommandHandlerContext;
  publicName: string;
  version: string;
}): Promise<{ message: string; options: TelegramReplyOptions | undefined }> {
  const language = context.runtime.bot.language ?? 'ca';
  if (context.runtime.chat.kind === 'private') {
    const message = formatStartMessage({
      publicName,
      version,
      isAdmin: context.runtime.actor.isAdmin,
      isApproved: context.runtime.actor.isApproved,
      language,
    });
    const summaries = [
      await buildTodayAtClubSummaryForStart(context, language),
      await buildNoticeStartSummary(context, language),
    ].filter((summary): summary is string => Boolean(summary));
    const options = await buildReplyOptionsForCurrentActionMenu(context);

    return {
      message: summaries.length > 0 ? `${message}\n\n${summaries.join('\n\n')}` : message,
      options: summaries.length > 0 ? { ...options, parseMode: 'HTML' } : options,
    };
  }

  const privateUrl = context.runtime.bot.username ? `https://t.me/${context.runtime.bot.username}?start=from_group` : undefined;
  return {
    message: formatGroupStartMessage({ publicName, language }),
    options: privateUrl
      ? {
          inlineKeyboard: [[{ text: createTelegramI18n(language).common.startOpenPrivateButton, url: privateUrl }]],
        }
      : undefined,
  };
}

async function buildTodayAtClubSummaryForStart(
  context: TelegramCommandHandlerContext,
  language: 'ca' | 'es' | 'en',
): Promise<string | undefined> {
  if (!context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return undefined;
  }

  try {
    return await buildTodayAtClubSummary({
      language,
      scheduleRepository: createDatabaseScheduleRepository({ database: context.runtime.services.database.db as never }),
      venueEventRepository: createDatabaseVenueEventRepository({ database: context.runtime.services.database.db as never }),
    });
  } catch {
    return undefined;
  }
}

function registerMembershipCallbacks({
  bot,
  publicName,
  adminElevationPasswordHash,
}: {
  bot: TelegramBotLike;
  publicName: string;
  adminElevationPasswordHash: string;
}): void {
  bot.onCallback('menu:review_access', async (context) => {
    await handleReviewAccess(context);
  });

  bot.onCallback('menu:help', async (context) => {
    await context.reply(
      renderTelegramHelpMessage({
        commands: createDefaultCommands({ publicName, adminElevationPasswordHash }),
        context,
        section: resolveHelpSection(context),
      }),
    );
  });

  bot.onCallback('approve_access:', async (context) => {
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'approve_access:', context.runtime.bot.language ?? 'ca');
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const result = await approveMembershipRequest({
      repository,
      applicantTelegramUserId,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
    });

    await context.reply(result.adminMessage);
  });

  bot.onCallback('reject_access:', async (context) => {
    const applicantTelegramUserId = parseCallbackTarget(context.callbackData, 'reject_access:', context.runtime.bot.language ?? 'ca');
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const result = await rejectMembershipRequest({
      repository,
      applicantTelegramUserId,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
    });

    await context.reply(result.adminMessage);
    if (result.outcome === 'blocked') {
      await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
    }
  });

  bot.onCallback(membershipRevokeSelectPrefix, async (context) => {
    const targetTelegramUserId = parseCallbackTarget(
      context.callbackData,
      membershipRevokeSelectPrefix,
      context.runtime.bot.language ?? 'ca',
    );
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const targetUser = await repository.findUserByTelegramUserId(targetTelegramUserId);
    const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');

    if (!targetUser || targetUser.status !== 'approved' || targetUser.isAdmin) {
      await context.reply(i18n.common.noRevocableUsers);
      return;
    }

    await context.runtime.session.start({
      flowKey: membershipRevokeFlowKey,
      stepKey: 'reason',
      data: {
        targetTelegramUserId,
      },
    });
    await context.reply(
      `${formatMembershipUserLabel(targetUser)}\n\n${i18n.common.revokeReasonPrompt}`,
      { replyKeyboard: [['/cancel']], resizeKeyboard: true, persistentKeyboard: true },
    );
  });

  bot.onCallback(membershipUserDetailPrefix, async (context) => {
    const targetTelegramUserId = parseCallbackTarget(
      context.callbackData,
      membershipUserDetailPrefix,
      context.runtime.bot.language ?? 'ca',
    );
    await handleManageUserDetail(context, targetTelegramUserId);
  });

  bot.onCallback(membershipRevokeConfirmCallback, async (context) => {
    const session = context.runtime.session.current;
    if (session?.flowKey !== membershipRevokeFlowKey || session.stepKey !== 'confirm') {
      await context.reply(createTelegramI18n(context.runtime.bot.language ?? 'ca').common.noActiveFlowToCancel);
      return;
    }

    const targetTelegramUserId = getSessionNumber(session.data, 'targetTelegramUserId');
    const reason = getSessionString(session.data, 'reason');
    const repository = createDatabaseMembershipAccessRepository({
      database: context.runtime.services.database.db,
    });
    const targetUser = await repository.findUserByTelegramUserId(targetTelegramUserId);
    if (!targetUser) {
      throw new Error(`Membership user ${targetTelegramUserId} not found before revocation`);
    }

    const result = await revokeMembershipAccess({
      repository,
      applicantTelegramUserId: targetTelegramUserId,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
      reason,
    });

    await context.runtime.session.cancel();
    await context.reply(result.adminMessage, await buildReplyOptionsForCurrentActionMenu(context));

    if (result.outcome !== 'revoked') {
      return;
    }

    await context.runtime.bot.sendPrivateMessage(targetTelegramUserId, result.applicantMessage);

    const storage = createDatabaseAppMetadataSessionStorage({
      database: context.runtime.services.database.db,
    });
    const languagePreferenceStore = createAppMetadataTelegramLanguagePreferenceStore({ storage });
    await notifyApprovedAdminsOfMembershipRevocation({
      membershipRepository: repository,
      languagePreferenceReader: languagePreferenceStore,
      privateMessageSender: context.runtime.bot,
      revokedUser: targetUser,
      revokedBy: {
        telegramUserId: context.runtime.actor.telegramUserId,
        displayName: resolveRequesterDisplayName(context),
        ...(context.from?.username !== undefined ? { username: context.from.username } : {}),
      },
      reason,
    });
  });

  bot.onCallback(membershipRevokeCancelCallback, async (context) => {
    await context.runtime.session.cancel();
    await context.reply(
      createTelegramI18n(context.runtime.bot.language ?? 'ca').common.flowCancelled,
      await buildReplyOptionsForCurrentActionMenu(context),
    );
  });
}

function registerTableAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(tableAdminCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramTableAdminCallback(context);
    });
  }
}

function registerCatalogAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(catalogAdminCallbackPrefixes.inspect, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseMenu, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseSearch, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseFamily, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.browseLetters, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.inspectGroup, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.edit, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.createActivity, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.autocorrect, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.autocorrectBggCandidate, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.translateDescription, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.setOwnerSelf, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.ownerPage, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.selectOwner, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.clearOwner, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.deactivate, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.addMedia, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.editMedia, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.deleteMedia, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
}

function registerTableReadCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(tableReadCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramTableReadCallback(context);
    });
  }
}

function registerCatalogReadCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  bot.onCallback(catalogReadCallbackPrefixes.overview, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.pageNext, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.pagePrev, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.back, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.myLoans, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectLetter, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectFamily, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectGroup, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogReadCallbackPrefixes.inspectItem, async (context) => {
    await handleTelegramCatalogReadCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.openMyLoans, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.adminDashboard, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.adminDashboardPage, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.create, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.return, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
  bot.onCallback(catalogLoanCallbackPrefixes.edit, async (context) => {
    await handleTelegramCatalogLoanCallback(context);
  });
}

function registerStorageCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(storageCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramStorageCallback(context);
    });
  }
}

function registerScheduleCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(scheduleCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramScheduleCallback(context);
    });
  }
}

function registerVenueEventAdminCallbacks({
  bot,
}: {
  bot: TelegramBotLike;
}): void {
  for (const callbackPrefix of Object.values(venueEventAdminCallbackPrefixes)) {
    bot.onCallback(callbackPrefix, async (context) => {
      await handleTelegramVenueEventAdminCallback(context);
    });
  }
}

async function handleReviewAccess(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await listPendingMembershipRequests({ repository });

  if (result.pendingUsers.length === 0) {
    await context.reply(i18n.common.noPendingRequests);
    return;
  }

  const lines = [
    i18n.common.pendingRequestsHeader,
    ...result.pendingUsers.map(
      (user) =>
        `- ${user.displayName} (${user.username ? `@${user.username}` : user.telegramUserId}) -> /approve ${user.telegramUserId} o /reject ${user.telegramUserId}`,
    ),
  ] as string[];

  await context.reply(lines.join('\n'), {
    inlineKeyboard: result.pendingUsers.map((user) => [
      {
        text: i18n.common.approveButton,
        callbackData: `approve_access:${user.telegramUserId}`,
      },
      {
        text: i18n.common.rejectButton,
        callbackData: `reject_access:${user.telegramUserId}`,
      },
    ]),
  });
}

async function handleManageUsers(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await listManageableMembershipUsers({ repository });

  if (result.users.length === 0) {
    await context.reply(i18n.common.noManageableUsers);
    return;
  }

  const lines = [
    i18n.common.manageUsersHeader,
    ...result.users.map((user) => formatManageableUserListLine(user, context.runtime.bot.username, i18n.common)),
  ];

  await context.reply(lines.join('\n'), { parseMode: 'HTML' });
}

async function handleManageUserDetail(context: TelegramCommandHandlerContext, targetTelegramUserId: number): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    await context.reply(i18n.common.accessDeniedAdmin);
    return;
  }

  const membershipRepository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const targetUser = await membershipRepository.findUserByTelegramUserId(targetTelegramUserId);
  if (!targetUser) {
    await context.reply(i18n.common.userManagementTargetMissing);
    return;
  }

  await context.runtime.session.start({
    flowKey: membershipUserManagementFlowKey,
    stepKey: 'detail',
    data: { targetTelegramUserId },
  });

  const catalogLoanRepository = createDatabaseCatalogLoanRepository({
    database: context.runtime.services.database.db,
  });
  const scheduleRepository = createDatabaseScheduleRepository({
    database: context.runtime.services.database.db,
  });
  const now = new Date().toISOString();
  const listActiveEventsByParticipant = scheduleRepository.listActiveEventsByParticipant?.bind(scheduleRepository);
  const [activeLoans, futureEvents, recentEvents] = await Promise.all([
    catalogLoanRepository.listActiveLoansWithItemsByBorrower
      ? catalogLoanRepository.listActiveLoansWithItemsByBorrower(targetTelegramUserId)
      : catalogLoanRepository.listActiveLoansByBorrower(targetTelegramUserId).then((loans) =>
          loans.map((loan) => ({
            ...loan,
            itemDisplayName: `Item ${loan.itemId}`,
            itemLifecycleStatus: 'active' as const,
          })),
        ),
    listActiveEventsByParticipant ? listActiveEventsByParticipant({
      participantTelegramUserId: targetTelegramUserId,
      startsAtFrom: now,
      limit: 10,
      order: 'asc',
    }) : Promise.resolve([]),
    listActiveEventsByParticipant ? listActiveEventsByParticipant({
      participantTelegramUserId: targetTelegramUserId,
      startsAtTo: now,
      limit: 5,
      order: 'desc',
    }) : Promise.resolve([]),
  ]);

  await context.reply(
    formatManageUserDetail({
      user: targetUser,
      activeLoans,
      futureEvents,
      recentEvents,
      labels: i18n.common,
      language: context.runtime.bot.language ?? 'ca',
    }),
    {
      parseMode: 'HTML',
      replyKeyboard: buildManageUserDetailKeyboard({
        user: targetUser,
        actorTelegramUserId: context.runtime.actor.telegramUserId,
        labels: i18n.common,
      }),
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  );
}

async function handleTelegramActionMenuText(
  context: TelegramCommandHandlerContext,
  commandConfig: {
    publicName: string;
    adminElevationPasswordHash: string;
  },
): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text) {
    return false;
  }

  if (matchesActionMenuLabel(text, 'start')) {
    return replyWithStartAndDefaultKeyboard(context);
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const selection = resolveTelegramMenuSelection({
    context: {
      actor: context.runtime.actor,
      authorization: context.runtime.authorization,
      chat: context.runtime.chat,
      session: context.runtime.session.current,
      language,
    },
    text,
  });

  if (selection && selection.uxSection !== 'flow') {
    if (selection.actionId === 'review_access') {
      if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
        await handleReviewAccess(context);
        return true;
      }

      return false;
    }

    if (selection.actionId === 'manage_users') {
      if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
        await handleManageUsers(context);
        return true;
      }

      return false;
    }

    if (selection.actionId === 'access') {
      if (context.runtime.chat.kind === 'private' && !context.runtime.actor.isApproved && !context.runtime.actor.isBlocked) {
        await handlePrivateAutoMembershipRequest(context);
        return true;
      }

      return false;
    }

    if (selection.actionId === 'tables_read') {
      if (context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved && !context.runtime.actor.isBlocked && !context.runtime.actor.isAdmin) {
        await handleTelegramTableReadCommand(context);
        return true;
      }

      return false;
    }

    if (selection.actionId === 'start') {
      return replyWithStartAndDefaultKeyboard(context);
    }

    if (selection.actionId === 'help') {
      await context.reply(
        renderTelegramHelpMessage({
          commands: createDefaultCommands(commandConfig),
          context,
          section: resolveHelpSection(context),
        }),
      );
      return true;
    }

    const localizedContext = { ...context, messageText: selection.label };

    if (selection.actionId === 'change_display_name') {
      await startMembershipChangeDisplayNameFlow(context);
      return true;
    }

    if (selection.actionId === 'welcome_templates') {
      await handleWelcomeTemplatesAdminMenu(context);
      return true;
    }

    if (selection.actionId === 'language') {
      return handleTelegramLanguageText(localizedContext);
    }

    if (selection.actionId === 'storage') {
      const handled = await handleTelegramStorageText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'storage');
      }
      return handled;
    }

    if (selection.actionId === 'group_purchases') {
      const handled = await handleTelegramGroupPurchaseText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'group_purchases');
      }
      return handled;
    }

    if (selection.actionId === 'lfg') {
      const handled = await handleTelegramLfgText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'lfg');
      }
      return handled;
    }

    if (selection.actionId === 'notices') {
      const handled = await handleTelegramNoticeText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'notices');
      }
      return handled;
    }

    if (selection.actionId === 'schedule') {
      const handled = await handleTelegramScheduleText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'schedule');
      }
      return handled;
    }

    if (selection.actionId === 'tables') {
      return handleTelegramTableAdminText(localizedContext);
    }

    if (selection.actionId === 'catalog') {
      if (await handleTelegramCatalogAdminText(localizedContext)) {
        setActiveHelpSection(context, 'catalog');
        return true;
      }

      const handled = await handleTelegramCatalogReadText(localizedContext);
      if (handled) {
        setActiveHelpSection(context, 'catalog');
      }
      return handled;
    }
  }

  if (matchesActionMenuLabel(text, 'reviewAccess')) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
      await handleReviewAccess(context);
      return true;
    }

    return false;
  }

  if (matchesActionMenuLabel(text, 'manageUsers')) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
      await handleManageUsers(context);
      return true;
    }

    return false;
  }

  if (matchesActionMenuLabel(text, 'access')) {
    if (context.runtime.chat.kind === 'private' && !context.runtime.actor.isApproved && !context.runtime.actor.isBlocked) {
      await handlePrivateAutoMembershipRequest(context);
      return true;
    }

    return false;
  }

  if (await handleMembershipUserManagementText(context, { publicName: commandConfig.publicName })) {
    return true;
  }

  if (matchesActionMenuLabel(text, 'tablesRead')) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved && !context.runtime.actor.isBlocked && !context.runtime.actor.isAdmin) {
      await handleTelegramTableReadCommand(context);
      return true;
    }

    return false;
  }

  if (await handleMembershipRevocationText(context)) {
    return true;
  }

  if (matchesActionMenuLabel(text, 'help')) {
    await context.reply(
      renderTelegramHelpMessage({
        commands: createDefaultCommands(commandConfig),
        context,
        section: resolveHelpSection(context),
      }),
    );
    return true;
  }

  return false;
}

type TelegramActionMenuTextKey = keyof ReturnType<typeof createTelegramI18n>['actionMenu'];
type CommonTextKey = keyof ReturnType<typeof createTelegramI18n>['common'];

function matchesActionMenuLabel(text: string, key: TelegramActionMenuTextKey): boolean {
  return supportedBotLanguages.some((language) => createTelegramI18n(language).actionMenu[key] === text);
}

function matchesCommonLabel(text: string, key: CommonTextKey): boolean {
  return supportedBotLanguages.some((language) => createTelegramI18n(language).common[key] === text);
}

async function replyWithStartAndDefaultKeyboard(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (await handlePrivateAutoMembershipRequest(context)) {
    return true;
  }

  await context.runtime.session.cancel();
  const startReply = await buildStartReply({
    context,
    publicName: context.runtime.bot.publicName,
    version: APP_VERSION,
  });
  await context.reply(startReply.message, startReply.options);
  return true;
}

async function clearTelegramTemporaryState(context: TelegramCommandHandlerContext): Promise<number> {
  activeHelpSections.clear();

  const storage = createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
  const rows = await storage.listByPrefix('telegram.session:');
  let deletedSessions = 0;

  for (const row of rows) {
    if (await storage.delete(row.key)) {
      deletedSessions += 1;
    }
  }

  return deletedSessions;
}

async function startMembershipAccessDisplayNameFlow(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  await context.runtime.session.start({
    flowKey: membershipAccessDisplayNameFlowKey,
    stepKey: 'display-name',
    data: {},
  });
  await context.reply(i18n.common.displayNamePrompt, {
    replyKeyboard: [['/cancel']],
    resizeKeyboard: true,
    persistentKeyboard: true,
  });
}

async function startMembershipChangeDisplayNameFlow(context: TelegramCommandHandlerContext): Promise<void> {
  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const user = await repository.findUserByTelegramUserId(context.runtime.actor.telegramUserId);
  const currentDisplayName = user?.displayName ?? resolveRequesterDisplayName(context);

  await context.runtime.session.start({
    flowKey: membershipChangeDisplayNameFlowKey,
    stepKey: 'display-name',
    data: {},
  });
  await context.reply(
    i18n.common.displayNameChangePrompt.replace('{displayName}', currentDisplayName),
    {
      replyKeyboard: [['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    },
  );
}

async function handleMembershipDisplayNameText(context: TelegramCommandHandlerContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (!session || ![membershipAccessDisplayNameFlowKey, membershipChangeDisplayNameFlowKey].includes(session.flowKey)) {
    return false;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const displayName = normalizeDisplayName(context.messageText);
  if (!displayName) {
    await context.reply(i18n.common.displayNameInvalid);
    return true;
  }

  if (session.flowKey === membershipAccessDisplayNameFlowKey) {
    await context.runtime.session.cancel();
    await submitMembershipAccessRequest(context, displayName);
    return true;
  }

  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await updateMembershipDisplayName({
    repository,
    telegramUserId: context.runtime.actor.telegramUserId,
    displayName,
  });
  await context.runtime.session.cancel();
  await context.reply(
    result.outcome === 'updated'
      ? i18n.common.displayNameSaved.replace('{displayName}', result.user?.displayName ?? displayName)
      : result.message,
    await buildReplyOptionsForCurrentActionMenu(context),
  );
  return true;
}

async function submitMembershipAccessRequest(
  context: TelegramCommandHandlerContext,
  displayName: string,
): Promise<void> {
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const result = await requestMembershipAccess({
    repository,
    telegramUserId: context.runtime.actor.telegramUserId,
    ...(context.from?.username !== undefined ? { username: context.from.username } : {}),
    displayName,
  });

  if (result.outcome === 'created') {
    const storage = createDatabaseAppMetadataSessionStorage({
      database: context.runtime.services.database.db,
    });
    const subscriptionStore = createAppMetadataMembershipRequestNotificationSubscriptionStore({ storage });
    const languagePreferenceStore = createAppMetadataTelegramLanguagePreferenceStore({ storage });

    await notifySubscribedAdminsOfMembershipRequest({
      store: subscriptionStore,
      membershipRepository: repository,
      languagePreferenceReader: languagePreferenceStore,
      privateMessageSender: context.runtime.bot,
      requesterTelegramUserId: context.runtime.actor.telegramUserId,
      requesterDisplayName: displayName,
      ...(context.from?.username !== undefined ? { requesterUsername: context.from.username } : {}),
      priorRevocation: await repository.findLatestRevocation(context.runtime.actor.telegramUserId),
    });
  }

  await context.reply(result.message, await buildReplyOptionsForCurrentActionMenu(context));
}

async function handleMembershipAutojoinCommand(context: TelegramCommandHandlerContext): Promise<void> {
  const action = context.messageText?.trim().split(/\s+/)[1]?.toLowerCase();
  if (action !== 'enabled' && action !== 'disabled') {
    await context.reply('Ús: /autojoin enabled o /autojoin disabled');
    return;
  }

  const storage = createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
  const store = createAppMetadataMembershipAutojoinStore({ storage });
  const result = await toggleMembershipAutojoin({
    store,
    chatId: context.runtime.chat.chatId,
    enabled: action === 'enabled',
  });

  const chatLabel = context.runtime.chat.chatTitle ? ` en ${context.runtime.chat.chatTitle}` : '';
  if (result === 'enabled') {
    await context.reply(`Autojoin activat${chatLabel}. Les noves entrades del grup s'aprovaran automàticament com a membres.`);
    return;
  }

  if (result === 'already-enabled') {
    await context.reply(`Autojoin ja estava activat${chatLabel}.`);
    return;
  }

  if (result === 'disabled') {
    await context.reply(`Autojoin desactivat${chatLabel}.`);
    return;
  }

  await context.reply(`Autojoin ja estava desactivat${chatLabel}.`);
}

async function handleMembershipAutojoinNewMembers(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (!context.newChatMembers?.length || context.runtime.chat.kind === 'private') {
    return false;
  }

  const storage = createDatabaseAppMetadataSessionStorage({
    database: context.runtime.services.database.db,
  });
  const store = createAppMetadataMembershipAutojoinStore({ storage });
  if (!(await store.isEnabled(context.runtime.chat.chatId))) {
    return false;
  }

  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });

  for (const member of context.newChatMembers) {
    if (member.is_bot) {
      continue;
    }

    const existing = await repository.findUserByTelegramUserId(member.id);
    if (existing?.status === 'approved') {
      await repository.syncUserProfile({
        telegramUserId: member.id,
        ...(member.username !== undefined ? { username: member.username } : {}),
        displayName: resolveTelegramDisplayName(member),
      });
      continue;
    }

    if (existing?.status === 'blocked') {
      continue;
    }

    await requestMembershipAccess({
      repository,
      telegramUserId: member.id,
      ...(member.username !== undefined ? { username: member.username } : {}),
      displayName: resolveTelegramDisplayName(member),
    });

    const result = await approveMembershipRequest({
      repository,
      applicantTelegramUserId: member.id,
      adminTelegramUserId: context.runtime.actor.telegramUserId,
    });
    if (result.outcome === 'approved' || result.outcome === 'already-approved') {
      await sendMembershipAutojoinWelcomeToCurrentGroup({
        context,
        repository,
        telegramUserId: member.id,
      });
    }
  }

  return true;
}

async function sendMembershipAutojoinWelcomeToCurrentGroup({
  context,
  repository,
  telegramUserId,
}: {
  context: TelegramCommandHandlerContext;
  repository: ReturnType<typeof createDatabaseMembershipAccessRepository>;
  telegramUserId: number;
}): Promise<void> {
  const approvedUser = await repository.findUserByTelegramUserId(telegramUserId);
  if (!approvedUser) {
    return;
  }

  const storage = getWelcomeTemplateStorage(context);
  const templateStore = createAppMetadataWelcomeTemplateStore({ storage });
  const template = await pickRememberedRandomWelcomeTemplate({
    storage,
    templateStore,
    telegramUserId: approvedUser.telegramUserId,
  });
  if (!template) {
    return;
  }

  await sendWelcomeTemplateToGroupChat(context, context.runtime.chat.chatId, {
    template,
    htmlMessage: renderWelcomeTemplateHtml(template, approvedUser.displayName),
    messageThreadId: context.messageThreadId ?? null,
  });
}

function scheduleProcessRestart(delayMs = 750): void {
  const timer = setTimeout(() => {
    throw new Error('Admin requested Telegram bot restart via /restart');
  }, delayMs);
  timer.unref();
}

async function handlePrivateAutoMembershipRequest(
  context: TelegramCommandHandlerContext,
): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private' || context.runtime.actor.isApproved || context.runtime.actor.isBlocked) {
    return false;
  }

  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const existing = await repository.findUserByTelegramUserId(context.runtime.actor.telegramUserId);

  if (existing?.status === 'blocked' || existing?.status === 'approved') {
    return false;
  }

  if (existing?.status === 'pending') {
    await submitMembershipAccessRequest(context, existing.displayName);
    return true;
  }

  await startMembershipAccessDisplayNameFlow(context);
  return true;
}

function setActiveHelpSection(context: TelegramCommandHandlerContext, section: TelegramHelpSection): void {
  const key = activeHelpSectionKey(context);
  if (key) {
    activeHelpSections.set(key, section);
  }
}

function getActiveHelpSection(context: TelegramCommandHandlerContext): TelegramHelpSection | undefined {
  const key = activeHelpSectionKey(context);
  return key ? activeHelpSections.get(key) : undefined;
}

function resolveHelpSection(context: TelegramCommandHandlerContext): TelegramHelpSection {
  const activeSection = getActiveHelpSection(context);
  if (activeSection) {
    return activeSection;
  }

  const menu = resolveCurrentActionMenu(context);
  if (!menu) {
    return resolveDefaultHelpSection(context);
  }

  if (menu.menuId === 'private-admin-default') {
    return 'private-admin-default';
  }

  if (menu.menuId === 'private-approved-default') {
    return 'private-approved-default';
  }

  if (menu.menuId === 'private-pending-default') {
    return 'private-pending-default';
  }

  if (menu.menuId === 'default-shared') {
    return 'default-shared';
  }

  return resolveDefaultHelpSection(context);
}

function resolveDefaultHelpSection(context: TelegramCommandHandlerContext): TelegramHelpSection {
  if (context.runtime.chat.kind === 'private') {
    if (context.runtime.actor.isAdmin) {
      return 'private-admin-default';
    }
    if (context.runtime.actor.isApproved) {
      return 'private-approved-default';
    }
    return 'private-pending-default';
  }

  return 'default-shared';
}

function parseStartCommandPayload(messageText: string | undefined): string | undefined {
  return messageText?.trim().split(/\s+/).slice(1).join(' ').trim() || undefined;
}

async function handleWelcomeCommand(context: TelegramCommandHandlerContext, publicName: string): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const accessRequestLink = context.runtime.bot.username
    ? `<a href="${buildTelegramStartUrl('request_access')}">${i18n.common.welcomeAccessLinkText}</a>`
    : i18n.common.welcomeAccessLinkText;
  const startChatLink = context.runtime.bot.username
    ? `<a href="${buildTelegramStartUrl('from_welcome')}">${i18n.common.welcomePrivateChatLinkText}</a>`
    : i18n.common.welcomePrivateChatLinkText;

  const prompt = context.runtime.actor.isApproved
    ? i18n.common.welcomeApprovedPrompt.replace('{startChatLink}', startChatLink)
    : i18n.common.welcomePendingPrompt.replace('{accessRequestLink}', accessRequestLink);

  await context.reply(
    `${i18n.common.welcomeIntro.replace('{publicName}', publicName)}\n\n${prompt}`,
    {
      parseMode: 'HTML',
    },
  );
}

function clearActiveHelpSection(context: TelegramCommandHandlerContext): void {
  const key = activeHelpSectionKey(context);
  if (key) {
    activeHelpSections.delete(key);
  }
}

function activeHelpSectionKey(context: TelegramCommandHandlerContext): string | undefined {
  const telegramUserId = context.runtime.actor.telegramUserId;
  if (!telegramUserId) {
    return undefined;
  }

  return `${context.runtime.chat.chatId}:${telegramUserId}`;
}

async function buildReplyOptionsForCurrentActionMenu(
  context: TelegramCommandHandlerContext,
): Promise<TelegramReplyOptions | undefined> {
  const menu = resolveCurrentActionMenu(context);
  if (!menu) {
    return undefined;
  }

  await recordTelegramMenuShown(context, menu);
  return menu;
}

function resolveCurrentActionMenu(context: TelegramCommandHandlerContext): TelegramResolvedActionMenu | undefined {
  return resolveTelegramActionMenu({
    context: {
      actor: context.runtime.actor,
      authorization: context.runtime.authorization,
      chat: context.runtime.chat,
      session: context.runtime.session.current,
      language: context.runtime.bot.language ?? 'ca',
    },
  });
}

async function recordCurrentMenuActionSelection(
  context: TelegramCommandHandlerContext,
): Promise<void> {
  const text = context.messageText?.trim();
  if (!text) {
    return;
  }

  const selection = resolveTelegramMenuSelection({
    context: {
      actor: context.runtime.actor,
      authorization: context.runtime.authorization,
      chat: context.runtime.chat,
      session: context.runtime.session.current,
      language: context.runtime.bot.language ?? 'ca',
    },
    text,
  });
  if (!selection || selection.uxSection === 'flow') {
    return;
  }

  await safeAppendTelegramMenuEvent(context, {
    actionKey: 'telegram.menu.action_selected',
    targetType: 'telegram-menu',
    targetId: selection.menuId,
    summary: `Telegram menu action selected: ${selection.actionId}`,
    details: {
      chatKind: context.runtime.chat.kind,
      actorRole: resolveTelegramMenuActorRole(context),
      language: context.runtime.bot.language ?? 'ca',
      menuId: selection.menuId,
      actionId: selection.actionId,
      telemetryActionKey: selection.telemetryActionKey,
      label: selection.label,
    },
  });
}

async function recordTelegramMenuShown(
  context: TelegramCommandHandlerContext,
  menu: TelegramResolvedActionMenu,
): Promise<void> {
  if (menu.menuId === 'active-flow') {
    return;
  }

  await safeAppendTelegramMenuEvent(context, {
    actionKey: 'telegram.menu.shown',
    targetType: 'telegram-menu',
    targetId: menu.menuId,
    summary: `Telegram menu shown: ${menu.menuId}`,
    details: {
      chatKind: context.runtime.chat.kind,
      actorRole: resolveTelegramMenuActorRole(context),
      language: context.runtime.bot.language ?? 'ca',
      visibleActionIds: menu.actions.map((action) => action.id),
      visibleLabels: menu.actions.map((action) => action.label),
    },
  });
}

async function safeAppendTelegramMenuEvent(
  context: TelegramCommandHandlerContext,
  event: {
    actionKey: string;
    targetType: string;
    targetId: string;
    summary: string;
    details: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await appendAuditEvent({
      repository: createDatabaseAuditLogRepository({ database: context.runtime.services.database.db as never }),
      actorTelegramUserId: context.runtime.actor.telegramUserId,
      actionKey: event.actionKey,
      targetType: event.targetType,
      targetId: event.targetId,
      summary: event.summary,
      details: event.details,
    });
  } catch {
    return;
  }
}

function resolveTelegramMenuActorRole(
  context: TelegramCommandHandlerContext,
): 'pending' | 'member' | 'admin' | 'blocked' {
  if (context.runtime.actor.isBlocked) {
    return 'blocked';
  }
  if (context.runtime.actor.isAdmin) {
    return 'admin';
  }
  if (context.runtime.actor.isApproved) {
    return 'member';
  }
  return 'pending';
}

async function handleTelegramMemberMenuDebugText(
  context: TelegramCommandHandlerContext,
): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isAdmin ||
    context.messageText?.trim() !== createTelegramI18n(language).actionMenu.memberDebug
  ) {
    return false;
  }

  await context.reply(createTelegramI18n(language).common.memberMenuDebugOpened, {
    ...resolveTelegramActionMenu({
      context: {
        actor: {
          ...context.runtime.actor,
          status: 'approved',
          isApproved: true,
          isAdmin: false,
        },
        authorization: context.runtime.authorization,
        chat: context.runtime.chat,
        session: context.runtime.session.current,
        language,
      },
    }),
  });
  return true;
}

function resolveRequesterDisplayName(context: Pick<TelegramCommandHandlerContext, 'from' | 'runtime'>): string {
  return resolveTelegramDisplayName(context.from);
}

function formatMembershipUserLabel(user: {
  telegramUserId: number;
  displayName: string;
  username?: string | null;
}): string {
  if (user.username && user.username.trim().length > 0) {
    return `${user.displayName} (@${user.username.replace(/^@/, '')})`;
  }

  return `${user.displayName} (${user.telegramUserId})`;
}

function shortMembershipUserLabel(user: {
  displayName: string;
  username?: string | null;
}): string {
  return user.username && user.username.trim().length > 0
    ? `${user.displayName} (@${user.username.replace(/^@/, '')})`
    : user.displayName;
}

function formatManageableUserListLine(
  user: {
    telegramUserId: number;
    displayName: string;
    username?: string | null;
    status: string;
    isAdmin: boolean;
  },
  botUsername: string | undefined,
  labels: CommonLabels,
): string {
  const detailUrl = botUsername ? buildTelegramStartUrl(`manage_user_${user.telegramUserId}`) : undefined;
  const name = detailUrl
    ? `<a href="${escapeHtml(detailUrl)}"><b>${escapeHtml(user.displayName)}</b></a>`
    : `<b>${escapeHtml(user.displayName)}</b>`;
  const username = formatTelegramUsernameLink(user.username);
  const status = formatMembershipStatusLabel(user.status, labels);
  const role = user.isAdmin ? labels.userRoleAdmin : labels.userRoleMember;
  return `- ${name}${username ? ` · ${username}` : ''} · ${escapeHtml(status)} · ${escapeHtml(role)}`;
}

function formatManageUserDetail({
  user,
  activeLoans,
  futureEvents,
  recentEvents,
  labels,
  language,
}: {
  user: {
    telegramUserId: number;
    displayName: string;
    username?: string | null;
    status: string;
    isAdmin: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  activeLoans: Array<{ itemDisplayName: string; createdAt: string; dueAt: string | null }>;
  futureEvents: Array<{ title: string; startsAt: string; organizerTelegramUserId: number }>;
  recentEvents: Array<{ title: string; startsAt: string; organizerTelegramUserId: number }>;
  labels: CommonLabels;
  language: 'ca' | 'es' | 'en';
}): string {
  const identity = [
    `<b>${escapeHtml(labels.userDetailHeader)}</b>`,
    `${labels.userDetailName}: <b>${escapeHtml(user.displayName)}</b>`,
    ...(user.username ? [`${labels.userDetailUsername}: ${formatTelegramUsernameLink(user.username)}`] : []),
    `${labels.userDetailTelegramId}: <code>${user.telegramUserId}</code>`,
    `${labels.userDetailStatus}: ${escapeHtml(formatMembershipStatusLabel(user.status, labels))}`,
    `${labels.userDetailRole}: ${escapeHtml(user.isAdmin ? labels.userRoleAdmin : labels.userRoleMember)}`,
    ...(user.createdAt ? [`${labels.userDetailCreatedAt}: ${escapeHtml(formatShortDateTime(user.createdAt, language))}`] : []),
    ...(user.updatedAt ? [`${labels.userDetailUpdatedAt}: ${escapeHtml(formatShortDateTime(user.updatedAt, language))}`] : []),
  ];
  const loanLines = activeLoans.length === 0
    ? [`- ${escapeHtml(labels.userDetailNoActiveLoans)}`]
    : activeLoans.map((loan) => {
        const due = loan.dueAt ? labels.userDetailLoanDue.replace('{date}', formatShortDateTime(loan.dueAt, language)) : labels.userDetailLoanNoDue;
        return `- <b>${escapeHtml(loan.itemDisplayName)}</b> · ${escapeHtml(labels.userDetailLoanedAt.replace('{date}', formatShortDateTime(loan.createdAt, language)))} · ${escapeHtml(due)}`;
      });
  const futureLines = futureEvents.length === 0
    ? [`- ${escapeHtml(labels.userDetailNoFutureEvents)}`]
    : futureEvents.map((event) => `- <b>${escapeHtml(event.title)}</b> · ${escapeHtml(formatShortDateTime(event.startsAt, language))}${event.organizerTelegramUserId === user.telegramUserId ? ` · ${escapeHtml(labels.userDetailOrganizer)}` : ''}`);
  const recentLines = recentEvents.length === 0
    ? [`- ${escapeHtml(labels.userDetailNoRecentEvents)}`]
    : recentEvents.map((event) => `- <b>${escapeHtml(event.title)}</b> · ${escapeHtml(formatShortDateTime(event.startsAt, language))}${event.organizerTelegramUserId === user.telegramUserId ? ` · ${escapeHtml(labels.userDetailOrganizer)}` : ''}`);

  return [
    ...identity,
    '',
    `<b>${escapeHtml(labels.userDetailActiveLoans)} (${activeLoans.length})</b>`,
    ...loanLines,
    '',
    `<b>${escapeHtml(labels.userDetailFutureEvents)} (${futureEvents.length})</b>`,
    ...futureLines,
    '',
    `<b>${escapeHtml(labels.userDetailRecentEvents)} (${recentEvents.length})</b>`,
    ...recentLines,
  ].join('\n');
}

function buildManageUserDetailKeyboard({
  user,
  actorTelegramUserId,
  labels,
}: {
  user: { telegramUserId: number; status: string; isAdmin: boolean };
  actorTelegramUserId: number;
  labels: CommonLabels;
}): TelegramReplyKeyboardButton[][] {
  const rows: TelegramReplyKeyboardButton[][] = [];
  if (user.status === 'approved' && !user.isAdmin && user.telegramUserId !== actorTelegramUserId) {
    rows.push([{ text: labels.revokeButton, semanticRole: 'danger' }]);
  }
  if (user.status === 'approved' && !user.isAdmin) {
    rows.push([{ text: labels.grantAdminButton, semanticRole: 'success' }]);
  }
  if (user.status === 'approved' && user.isAdmin && user.telegramUserId !== actorTelegramUserId) {
    rows.push([{ text: labels.revokeAdminButton, semanticRole: 'danger' }]);
  }
  rows.push([labels.backToStartButton]);
  return rows;
}

async function handleMembershipUserManagementText(
  context: TelegramCommandHandlerContext,
  commandConfig: { publicName: string },
): Promise<boolean> {
  const session = context.runtime.session.current;
  const text = context.messageText?.trim();
  if (!text || session?.flowKey !== membershipUserManagementFlowKey || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  const targetTelegramUserId = getSessionNumber(session.data, 'targetTelegramUserId');
  if (text === i18n.common.backToStartButton || text === i18n.actionMenu.start) {
    await context.runtime.session.cancel();
    const startReply = await buildStartReply({ context, publicName: commandConfig.publicName, version: APP_VERSION });
    await context.reply(startReply.message, startReply.options);
    return true;
  }

  const membershipRepository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const targetUser = await membershipRepository.findUserByTelegramUserId(targetTelegramUserId);
  if (!targetUser) {
    await context.reply(i18n.common.userManagementTargetMissing);
    return true;
  }

  if (text === i18n.common.revokeButton) {
    if (targetUser.telegramUserId === context.runtime.actor.telegramUserId || targetUser.isAdmin || targetUser.status !== 'approved') {
      await context.reply(i18n.common.userManagementActionDenied);
      return true;
    }
    await context.runtime.session.start({
      flowKey: membershipRevokeFlowKey,
      stepKey: 'reason',
      data: { targetTelegramUserId },
    });
    await context.reply(`${formatMembershipUserLabel(targetUser)}\n\n${i18n.common.revokeReasonPrompt}`, {
      replyKeyboard: [['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  if (text === i18n.common.grantAdminButton || text === i18n.common.revokeAdminButton) {
    if (text === i18n.common.revokeAdminButton && targetUser.telegramUserId === context.runtime.actor.telegramUserId) {
      await context.reply(i18n.common.userManagementActionDenied);
      return true;
    }

    const repository = createDatabaseAdminElevationRepository({
      database: context.runtime.services.database.db,
    });
    const result = text === i18n.common.grantAdminButton
      ? await grantAdminRoleToUser({
          repository,
          targetTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
          reason: 'admin-user-management',
        })
      : await revokeAdminRoleFromUser({
          repository,
          targetTelegramUserId,
          adminTelegramUserId: context.runtime.actor.telegramUserId,
          reason: 'admin-user-management',
        });
    await context.reply(result.message);
    await handleManageUserDetail(context, targetTelegramUserId);
    return true;
  }

  return false;
}

function formatTelegramUsernameLink(username: string | null | undefined): string | null {
  const normalized = username?.trim().replace(/^@/, '');
  return normalized ? `<a href="https://t.me/${escapeHtml(normalized)}">@${escapeHtml(normalized)}</a>` : null;
}

function formatMembershipStatusLabel(status: string, labels: CommonLabels): string {
  if (status === 'approved') return labels.userStatusApproved;
  if (status === 'pending') return labels.userStatusPending;
  if (status === 'blocked') return labels.userStatusBlocked;
  if (status === 'revoked') return labels.userStatusRevoked;
  return status;
}

function formatShortDateTime(value: string, language: 'ca' | 'es' | 'en'): string {
  return new Intl.DateTimeFormat(language === 'ca' ? 'ca-ES' : language, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function handleMembershipRevocationText(
  context: TelegramCommandHandlerContext,
): Promise<boolean> {
  const session = context.runtime.session.current;
  const text = context.messageText?.trim();
  if (!text || session?.flowKey !== membershipRevokeFlowKey || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) {
    return false;
  }

  const i18n = createTelegramI18n(context.runtime.bot.language ?? 'ca');
  if (session.stepKey !== 'reason') {
    return false;
  }

  const reason = text.trim();
  if (reason.length === 0) {
    await context.reply(i18n.common.revokeReasonPrompt, {
      replyKeyboard: [['/cancel']],
      resizeKeyboard: true,
      persistentKeyboard: true,
    });
    return true;
  }

  const targetTelegramUserId = getSessionNumber(session.data, 'targetTelegramUserId');
  const repository = createDatabaseMembershipAccessRepository({
    database: context.runtime.services.database.db,
  });
  const targetUser = await repository.findUserByTelegramUserId(targetTelegramUserId);
  if (!targetUser) {
    throw new Error(`Membership user ${targetTelegramUserId} not found before revocation reason confirmation`);
  }

  await context.runtime.session.advance({
    stepKey: 'confirm',
    data: {
      ...session.data,
      reason,
    },
  });

  await context.reply(
    i18n.common.revokeConfirmPrompt
      .replace('{label}', formatMembershipUserLabel(targetUser))
      .replace('{reason}', reason),
    {
      inlineKeyboard: [[
        { text: i18n.common.revokeConfirmButton, callbackData: membershipRevokeConfirmCallback },
        { text: i18n.common.revokeCancelButton, callbackData: membershipRevokeCancelCallback },
      ]],
    },
  );
  return true;
}

function getSessionNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Conversation session is missing numeric field ${key}`);
  }

  return value;
}

function getSessionString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Conversation session is missing string field ${key}`);
  }

  return value;
}
