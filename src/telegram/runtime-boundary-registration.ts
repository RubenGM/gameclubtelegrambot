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
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { resolveTelegramDisplayName } from '../membership/display-name.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import {
  createAppMetadataMembershipRequestNotificationSubscriptionStore,
  notifyApprovedAdminsOfMembershipRevocation,
  notifySubscribedAdminsOfMembershipRequest,
  toggleMembershipRequestNotifications,
} from '../membership/request-notification-store.js';
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
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
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
import { buildTodayAtClubSummary } from './today-at-club-summary.js';
import { buildTelegramStartUrl } from './deep-links.js';
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
  registerScheduleCallbacks({ bot });
  registerGroupPurchaseCallbacks({ bot });
  registerLfgCallbacks({ bot });
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
    const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
    const i18n = createTelegramI18n(language);

    if (text === i18n.actionMenu.start) {
      clearActiveHelpSection(context);
    }

    if (await handleTelegramLanguageText(context)) {
      return;
    }

    if (await handleTelegramTranslatedActionMenuText(context, { publicName, adminElevationPasswordHash })) {
      return;
    }

    if (await handleTelegramMemberMenuDebugText(context)) {
      return;
    }

    if (await handlePrivateAutoMembershipRequest(context)) {
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
    if (await handleTelegramCatalogAdminMessage(context)) {
      return;
    }

    await handleTelegramStorageMessage(context);
  });
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
        const result = await requestMembershipAccess({
          repository,
          telegramUserId: context.runtime.actor.telegramUserId,
          ...(context.from?.username !== undefined ? { username: context.from.username } : {}),
          displayName: resolveRequesterDisplayName(context),
        });
        const priorRevocation = result.outcome === 'created'
          ? await repository.findLatestRevocation(context.runtime.actor.telegramUserId)
          : null;

        await context.reply(result.message);

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
            requesterDisplayName: resolveRequesterDisplayName(context),
            ...(context.from?.username !== undefined ? { requesterUsername: context.from.username } : {}),
            priorRevocation,
          });
        }
      },
    },
    {
      command: 'subscribe_requests',
      contexts: ['private'],
      access: 'admin',
      descriptionByLanguage: {
        ca: 'Activa avisos privats de noves sollicituds d accés',
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
        ca: 'Desactiva avisos privats de noves sollicituds d accés',
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
      description: 'Consulta i cerca el cataleg',
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
      description: 'Gestiona el cataleg manual del club',
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
      description: 'Revisa sollicituds pendents',
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
      description: 'Aprova una sollicitud',
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
        if (result.outcome === 'approved') {
          await sendPostApprovalWelcomeMessage({
            context,
            repository,
            applicantTelegramUserId,
            publicName,
            version: APP_VERSION,
          });
        }
      },
    },
    {
      command: 'reject',
      contexts: ['private'],
      access: 'admin',
      description: 'Rebutja una sollicitud',
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
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Mostra informació de benvinguda i d\'accés',
      handle: async (context) => {
        await handleWelcomeCommand(context, publicName);
      },
    },
    {
      command: 'bienvenida',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      descriptionByLanguage: {
        ca: 'Mostra informació de benvinguda i d\'accés',
        es: 'Muestra información de bienvenida y acceso',
        en: 'Show welcome and access information',
      },
      handle: async (context) => {
        await handleWelcomeCommand(context, publicName);
      },
    },
    {
      command: 'start',
      contexts: ['private'],
      access: 'public',
      description: 'Comprova que el bot esta actiu',
      handle: async (context) => {
        const startPayload = parseStartCommandPayload(context.messageText);

        if (startPayload === 'request_access' && (await handlePrivateAutoMembershipRequest(context))) {
          return;
        }

        const manageUserTarget = parseManageUserStartPayload(startPayload);
        if (manageUserTarget !== null) {
          await handleManageUserDetail(context, manageUserTarget);
          return;
        }

        if (await handlePrivateAutoMembershipRequest(context)) {
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
        ca: 'Envia l estat actual de les funcionalitats',
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

  if (!options.inlineKeyboard && !options.replyKeyboard) {
    return options.parseMode ? { parse_mode: options.parseMode } : undefined;
  }

  if (options.replyKeyboard) {
    return {
      reply_markup: {
        keyboard: options.replyKeyboard.map((row) => row.map((button) => toRawReplyKeyboardButton(button, buttonAppearance))),
        resize_keyboard: options.resizeKeyboard ?? true,
        is_persistent: options.persistentKeyboard ?? true,
      },
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
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
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
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
    const todaySummary = await buildTodayAtClubSummaryForStart(context, language);
    const options = await buildReplyOptionsForCurrentActionMenu(context);

    return {
      message: todaySummary ? `${message}\n\n${todaySummary}` : message,
      options: todaySummary ? { ...options, parseMode: 'HTML' } : options,
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

async function sendPostApprovalWelcomeMessage({
  context,
  repository,
  applicantTelegramUserId,
  publicName,
  version,
}: {
  context: TelegramCommandHandlerContext;
  repository: ReturnType<typeof createDatabaseMembershipAccessRepository>;
  applicantTelegramUserId: number;
  publicName: string;
  version: string;
}): Promise<void> {
  const approvedApplicant = await repository.findUserByTelegramUserId(applicantTelegramUserId);
  if (!approvedApplicant) {
    return;
  }

  const syntheticContext: TelegramCommandHandlerContext = {
    ...context,
    runtime: {
      ...context.runtime,
      actor: {
        ...context.runtime.actor,
        telegramUserId: approvedApplicant.telegramUserId,
        status: 'approved',
        isApproved: true,
        isBlocked: false,
        isAdmin: approvedApplicant.isAdmin,
      },
    },
  };

  try {
    const startReply = await buildStartReply({
      context: syntheticContext,
      publicName,
      version,
    });
    await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, startReply.message, startReply.options);
  } catch {
    return;
  }
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
    if (result.outcome === 'approved') {
      await sendPostApprovalWelcomeMessage({
        context,
        repository,
        applicantTelegramUserId,
        publicName,
        version: APP_VERSION,
      });
    }
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
  bot.onCallback(catalogAdminCallbackPrefixes.translateDescription, async (context) => {
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

async function handleTelegramTranslatedActionMenuText(
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

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);

  if (text === i18n.actionMenu.reviewAccess) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
      await handleReviewAccess(context);
      return true;
    }

    return false;
  }

  if (text === i18n.actionMenu.manageUsers) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin) {
      await handleManageUsers(context);
      return true;
    }

    return false;
  }

  if (text === i18n.actionMenu.access) {
    if (context.runtime.chat.kind === 'private' && !context.runtime.actor.isApproved && !context.runtime.actor.isBlocked) {
      await handlePrivateAutoMembershipRequest(context);
      return true;
    }

    return false;
  }

  if (await handleMembershipUserManagementText(context, { publicName: commandConfig.publicName })) {
    return true;
  }

  if (text === i18n.actionMenu.tablesRead) {
    if (context.runtime.chat.kind === 'private' && context.runtime.actor.isApproved && !context.runtime.actor.isBlocked && !context.runtime.actor.isAdmin) {
      await handleTelegramTableReadCommand(context);
      return true;
    }

    return false;
  }

  if (await handleMembershipRevocationText(context)) {
    return true;
  }

  if (text === i18n.actionMenu.start) {
    if (await handlePrivateAutoMembershipRequest(context)) {
      return true;
    }

    const startReply = await buildStartReply({
      context,
      publicName: context.runtime.bot.publicName,
      version: APP_VERSION,
    });
    await context.reply(startReply.message, startReply.options);
    return true;
  }

  if (text === i18n.actionMenu.help) {
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

  const result = await requestMembershipAccess({
    repository,
    telegramUserId: context.runtime.actor.telegramUserId,
    ...(context.from?.username !== undefined ? { username: context.from.username } : {}),
    displayName: resolveRequesterDisplayName(context),
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
      requesterDisplayName: resolveRequesterDisplayName(context),
      ...(context.from?.username !== undefined ? { requesterUsername: context.from.username } : {}),
      priorRevocation: await repository.findLatestRevocation(context.runtime.actor.telegramUserId),
    });
  }

  await context.reply(result.message, await buildReplyOptionsForCurrentActionMenu(context));
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
