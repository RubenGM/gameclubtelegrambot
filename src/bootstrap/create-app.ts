import type { RuntimeConfig } from '../config/runtime-config.js';
import type { AppRuntimeStatus } from '../domain/runtime-status.js';
import {
  createInfrastructureBoundary,
  type InfrastructureBoundary,
  type InfrastructureRuntimeServices,
} from '../infrastructure/runtime-boundary.js';
import {
  createTelegramBoundary,
  type TelegramBoundary,
  type TelegramFatalRuntimeErrorHandler,
} from '../telegram/runtime-boundary.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { createDatabaseCatalogLoanRepository } from '../catalog/catalog-loan-store.js';
import { createDatabaseCatalogLoanReminderRepository } from '../catalog/catalog-loan-reminder-store.js';
import { sendDueCatalogLoanReminders } from '../catalog/catalog-loan-reminders.js';
import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import { createDatabaseGroupPurchaseReminderRepository } from '../group-purchases/group-purchase-reminder-store.js';
import { sendDueGroupPurchaseReminders } from '../group-purchases/group-purchase-reminders.js';
import { createDatabaseNoticeRepository } from '../notices/notice-catalog-store.js';
import { expireDueNotices } from '../notices/notice-expiration.js';
import { createDatabaseScheduleRepository } from '../schedule/schedule-catalog-store.js';
import { createDatabaseScheduleEventReminderRepository } from '../schedule/schedule-reminder-store.js';
import { sendDueScheduleEventReminders } from '../schedule/schedule-reminders.js';
import { createScheduleReminderWorker, type ScheduleReminderWorker } from '../schedule/schedule-reminder-worker.js';
import { createAdminHttpServer, type AdminHttpServer } from '../http/admin-http-server.js';

export interface LoggerLike {
  info(bindings: object, message: string): void;
  error?(bindings: object, message: string): void;
}

export interface CreateAppOptions {
  config: RuntimeConfig;
  logger: LoggerLike;
  startInfrastructure?: () => Promise<InfrastructureBoundary>;
  startTelegram?: (options: {
    services: InfrastructureRuntimeServices;
    onFatalRuntimeError: TelegramFatalRuntimeErrorHandler;
  }) => Promise<TelegramBoundary>;
  startScheduleReminders?: (options: {
    services: InfrastructureRuntimeServices;
    telegram: TelegramBoundary;
  }) => ScheduleReminderWorker;
  startAdminHttpServer?: (options: {
    services: InfrastructureRuntimeServices;
    telegram: TelegramBoundary;
  }) => AdminHttpServer;
}

export interface App {
  start(): Promise<AppRuntimeStatus>;
  stop(): Promise<void>;
  onFatalRuntimeError?(handler: TelegramFatalRuntimeErrorHandler): void;
}

export function createApp({
  config,
  logger,
  startInfrastructure = () =>
    createInfrastructureBoundary({
      config,
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
    }),
  startTelegram = ({ services, onFatalRuntimeError }) =>
    createTelegramBoundary({
      config,
      services,
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
      onFatalRuntimeError,
    }),
  startScheduleReminders = ({ services, telegram }) =>
    createScheduleReminderWorker({
      enabled: true,
      intervalMs: 60_000,
      logger: {
        error: logger.error?.bind(logger) ?? (() => {}),
      },
      runOnce: async () => {
        if (config.notifications.defaults.eventRemindersEnabled) {
          await sendDueScheduleEventReminders({
            scheduleRepository: createDatabaseScheduleRepository({ database: services.database.db }),
            reminderRepository: createDatabaseScheduleEventReminderRepository({ database: services.database.db }),
            leadHours: config.notifications.defaults.eventReminderLeadHours,
            maxLeadHours: 168,
            language: config.bot.language,
            sendPrivateMessage: telegram.sendPrivateMessage,
          });
          await sendDueGroupPurchaseReminders({
            groupPurchaseRepository: createDatabaseGroupPurchaseRepository({ database: services.database.db }),
            reminderRepository: createDatabaseGroupPurchaseReminderRepository({ database: services.database.db }),
            leadHours: 24,
            language: config.bot.language,
            sendPrivateMessage: telegram.sendPrivateMessage,
          });
          await sendDueCatalogLoanReminders({
            catalogLoanRepository: createDatabaseCatalogLoanRepository({ database: services.database.db }),
            reminderRepository: createDatabaseCatalogLoanReminderRepository({ database: services.database.db }),
            leadHours: config.notifications.defaults.eventReminderLeadHours,
            language: config.bot.language,
            sendPrivateMessage: telegram.sendPrivateMessage,
          });
        }
        await maybeExpireDueNotices({
          services,
          telegram,
          logger,
        });
      },
    }),
  startAdminHttpServer = ({ services, telegram }) =>
    createAdminHttpServer({
      config,
      services,
      telegramSender: {
        sendPrivateMessage: telegram.sendPrivateMessage.bind(telegram),
        ...(telegram.sendGroupMessage ? { sendGroupMessage: async (chatId, message, options) => { await telegram.sendGroupMessage?.(chatId, message, options); } } : {}),
      },
      logger: {
        info: logger.info.bind(logger),
        error: logger.error?.bind(logger) ?? (() => {}),
      },
    }),
}: CreateAppOptions): App {
  let infrastructure: InfrastructureBoundary | undefined;
  let telegram: TelegramBoundary | undefined;
  let scheduleReminders: ScheduleReminderWorker | undefined;
  let adminHttpServer: AdminHttpServer | undefined;
  const fatalRuntimeErrorHandlers = new Set<TelegramFatalRuntimeErrorHandler>();
  const emitFatalRuntimeError = (error: unknown) => {
    for (const handler of fatalRuntimeErrorHandlers) {
      handler(error);
    }
  };

  return {
    onFatalRuntimeError(handler) {
      fatalRuntimeErrorHandlers.add(handler);
    },
    async start() {
      const startedInfrastructure = await startInfrastructure();
      infrastructure = startedInfrastructure;

      try {
        const startedTelegram = await startTelegram({
          services: startedInfrastructure.services,
          onFatalRuntimeError: emitFatalRuntimeError,
        });
        if (infrastructure !== startedInfrastructure) {
          await startedTelegram.stop();
          throw new Error('Application startup interrupted');
        }

        telegram = startedTelegram;
        scheduleReminders = startScheduleReminders({ services: startedInfrastructure.services, telegram });
        await scheduleReminders.start();
        adminHttpServer = startAdminHttpServer({ services: startedInfrastructure.services, telegram });
        await adminHttpServer.start();
        await notifyFirstAdminReady({
          config,
          logger,
          telegram: startedTelegram,
        });
      } catch (error) {
        if (infrastructure === startedInfrastructure) {
          await startedInfrastructure.stop();
          infrastructure = undefined;
        }
        throw error;
      }

      const status: AppRuntimeStatus = {
        service: 'gameclubtelegrambot',
        infrastructure: infrastructure.status,
        telegram: telegram.status,
      };

      logger.info(
        {
          bot: {
            clubName: config.bot.clubName,
            publicName: config.bot.publicName,
          },
          status,
        },
        'Application started with validated runtime configuration',
      );

      return status;
    },
    async stop() {
      const shutdownErrors: Error[] = [];

      if (telegram) {
        try {
          if (adminHttpServer) {
            await adminHttpServer.stop();
          }
          if (scheduleReminders) {
            await scheduleReminders.stop();
          }
          await telegram.stop();
        } catch (error) {
          shutdownErrors.push(normalizeError(error, 'Telegram shutdown failed'));
        }
      }

      if (infrastructure) {
        try {
          await infrastructure.stop();
        } catch (error) {
          shutdownErrors.push(normalizeError(error, 'Infrastructure shutdown failed'));
        }
      }

      telegram = undefined;
      scheduleReminders = undefined;
      adminHttpServer = undefined;
      infrastructure = undefined;

      if (shutdownErrors[0]) {
        throw shutdownErrors[0];
      }
    },
  };
}

let lastNoticeExpirationRunAt = 0;
const noticeExpirationIntervalMs = 15 * 60 * 1000;

async function maybeExpireDueNotices({
  services,
  telegram,
  logger,
}: {
  services: InfrastructureRuntimeServices;
  telegram: TelegramBoundary;
  logger: LoggerLike;
}): Promise<void> {
  const now = Date.now();
  if (now - lastNoticeExpirationRunAt < noticeExpirationIntervalMs) {
    return;
  }

  lastNoticeExpirationRunAt = now;
  const result = await expireDueNotices({
    noticeRepository: createDatabaseNoticeRepository({ database: services.database.db }),
    telegram,
    auditRepository: createDatabaseAuditLogRepository({ database: services.database.db }),
    now: new Date(now),
  });
  if (result.archived > 0 || result.deleteFailures > 0) {
    logger.info({
      archived: result.archived,
      deletedMessages: result.deletedMessages,
      deleteFailures: result.deleteFailures,
    }, 'Expired notices processed');
  }
}

function normalizeError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}

async function notifyFirstAdminReady({
  config,
  logger,
  telegram,
}: {
  config: RuntimeConfig;
  logger: LoggerLike;
  telegram: TelegramBoundary;
}): Promise<void> {
  try {
    await telegram.sendPrivateMessage(
      config.bootstrap.firstAdmin.telegramUserId,
      formatFirstAdminReadyMessage(config),
    );
  } catch (error) {
    logger.error?.(
      {
        error: error instanceof Error ? error.message : String(error),
        firstAdminTelegramUserId: config.bootstrap.firstAdmin.telegramUserId,
      },
      'First admin startup notification failed',
    );
  }
}

function formatFirstAdminReadyMessage(config: RuntimeConfig): string {
  switch (config.bot.language) {
    case 'es':
      return `${config.bot.publicName} está listo.`;
    case 'en':
      return `${config.bot.publicName} is ready.`;
    case 'ca':
    default:
      return `${config.bot.publicName} està llest.`;
  }
}
