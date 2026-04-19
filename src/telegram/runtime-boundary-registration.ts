import { APP_VERSION } from '../app-version.js';
import { elevateApprovedUserToAdmin } from '../membership/admin-elevation.js';
import { createDatabaseAdminElevationRepository } from '../membership/admin-elevation-store.js';
import {
  approveMembershipRequest,
  listRevocableMembershipUsers,
  listPendingMembershipRequests,
  rejectMembershipRequest,
  revokeMembershipAccess,
  requestMembershipAccess,
} from '../membership/access-flow.js';
import { createDatabaseMembershipAccessRepository } from '../membership/access-flow-store.js';
import { resolveTelegramDisplayName } from '../membership/display-name.js';
import {
  createAppMetadataMembershipRequestNotificationSubscriptionStore,
  notifyApprovedAdminsOfMembershipRevocation,
  notifySubscribedAdminsOfMembershipRequest,
  toggleMembershipRequestNotifications,
} from '../membership/request-notification-store.js';
import { resolveTelegramActionMenu } from './action-menu.js';
import { handleTelegramCalendarText } from './calendar-flow.js';
import {
  handleTelegramCatalogAdminCallback,
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
} from './command-registry.js';
import { createAppMetadataTelegramLanguagePreferenceStore } from './language-preference-store.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { handleTelegramLanguageCommand, handleTelegramLanguageText } from './language-flow.js';
import { handleTelegramNewsGroupText } from './news-group-flow.js';
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
  TelegramInlineButton,
  TelegramReplyOptions,
} from './runtime-boundary.js';

const membershipRevokeFlowKey = 'membership-revoke';
const membershipRevokeSelectPrefix = 'membership_revoke:select:';
const membershipRevokeConfirmCallback = 'membership_revoke:confirm';
const membershipRevokeCancelCallback = 'membership_revoke:cancel';

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
  registerTableReadCallbacks({ bot });
  registerTableAdminCallbacks({ bot });
  registerCatalogReadCallbacks({ bot });
  registerCatalogAdminCallbacks({ bot });
  registerVenueEventAdminCallbacks({ bot });
  registerTextHandlers({ bot, publicName, adminElevationPasswordHash });
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

    if (await handleTelegramVenueEventAdminText(context)) {
      return;
    }

    if (await handleTelegramCalendarText(context)) {
      return;
    }

    if (await handleTelegramScheduleText(context)) {
      return;
    }

    if (await handleTelegramTableAdminText(context)) {
      return;
    }

    if (await handleTelegramCatalogAdminText(context)) {
      return;
    }

    if (await handleTelegramCatalogReadText(context)) {
      return;
    }
  });
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
          await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
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
          buildReplyOptionsForCurrentActionMenu(context),
        );
      },
    },
    {
      command: 'start',
      contexts: ['private', 'group', 'group-news'],
      access: 'public',
      description: 'Comprova que el bot esta actiu',
      handle: async (context) => {
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
        if (await handleTelegramVenueEventAdminStartText({ ...context })) {
          return;
        }

        const startReply = buildStartReply({
          context,
          publicName,
          version: APP_VERSION,
        });
        await context.reply(startReply.message, startReply.options);
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

export function toGrammyReplyOptions(options?: TelegramReplyOptions): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  if (!options.inlineKeyboard && !options.replyKeyboard) {
    return options.parseMode ? { parse_mode: options.parseMode } : undefined;
  }

  if (options.replyKeyboard) {
    return {
      reply_markup: {
        keyboard: options.replyKeyboard.map((row) => row.map((buttonText) => ({ text: buttonText }))),
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
        row.map((button) => ({
          text: button.text,
          ...(button.url ? { url: button.url } : { callback_data: button.callbackData }),
        })),
      ),
    },
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
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

function buildStartReply({
  context,
  publicName,
  version,
}: {
  context: TelegramCommandHandlerContext;
  publicName: string;
  version: string;
}): { message: string; options: TelegramReplyOptions | undefined } {
  const language = context.runtime.bot.language ?? 'ca';
  if (context.runtime.chat.kind === 'private') {
    return {
      message: formatStartMessage({
        publicName,
        version,
        isAdmin: context.runtime.actor.isAdmin,
        isApproved: context.runtime.actor.isApproved,
        language,
      }),
      options: buildReplyOptionsForCurrentActionMenu(context),
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
      await context.runtime.bot.sendPrivateMessage(applicantTelegramUserId, result.applicantMessage);
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
    await context.reply(result.adminMessage, buildReplyOptionsForCurrentActionMenu(context));

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
      buildReplyOptionsForCurrentActionMenu(context),
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
  bot.onCallback(catalogAdminCallbackPrefixes.inspectGroup, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.edit, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.createActivity, async (context) => {
    await handleTelegramCatalogAdminCallback(context);
  });
  bot.onCallback(catalogAdminCallbackPrefixes.deactivate, async (context) => {
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
  const result = await listRevocableMembershipUsers({ repository });

  if (result.users.length === 0) {
    await context.reply(i18n.common.noRevocableUsers);
    return;
  }

  const lines = [
    i18n.common.revocableUsersHeader,
    ...result.users.map((user) => `- ${formatMembershipUserLabel(user)} -> ${i18n.common.revokeButton}`),
  ];

  await context.reply(lines.join('\n'), {
    inlineKeyboard: result.users.map((user) => [{
      text: `${i18n.common.revokeButton}: ${shortMembershipUserLabel(user)}`,
      callbackData: `${membershipRevokeSelectPrefix}${user.telegramUserId}`,
    }]),
  });
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

  if (await handleMembershipRevocationText(context)) {
    return true;
  }

  if (text === i18n.actionMenu.start) {
    if (await handlePrivateAutoMembershipRequest(context)) {
      return true;
    }

    const startReply = buildStartReply({
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

  await context.reply(result.message, buildReplyOptionsForCurrentActionMenu(context));
  return true;
}

function buildReplyOptionsForCurrentActionMenu(
  context: TelegramCommandHandlerContext,
): TelegramReplyOptions | undefined {
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
