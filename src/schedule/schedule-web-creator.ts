import type { RuntimeConfig } from '../config/runtime-config.js';
import type { DatabaseConnection } from '../infrastructure/database/connection.js';
import { eq } from 'drizzle-orm';
import { users } from '../infrastructure/database/schema.js';
import { appendAuditEvent } from '../audit/audit-log.js';
import { createDatabaseAuditLogRepository } from '../audit/audit-log-store.js';
import { synchronizeGoogleCalendarScheduleEvent } from '../google-calendar/google-calendar-sync.js';
import { createDatabaseNewsGroupRepository } from '../news/news-group-store.js';
import { createDatabaseClubTableRepository } from '../tables/table-catalog-store.js';
import { createDatabaseVenueEventRepository } from '../venue-events/venue-event-catalog-store.js';
import { createDatabaseAppMetadataSessionStorage } from '../telegram/conversation-session-store.js';
import {
  notifyScheduleConflicts,
  publishCalendarSnapshotToNewsGroups,
  publishPublicCalendarSnapshotToNewsGroups,
} from '../telegram/schedule-notifications.js';
import { createScheduleEvent, type ScheduleAttendanceMode, type ScheduleEventRecord } from './schedule-catalog.js';
import { createDatabaseScheduleRepository } from './schedule-catalog-store.js';

export interface ScheduleWebCreateInput {
  title: string;
  description: string | null;
  startsAt: string;
  durationMinutes: number;
  organizerTelegramUserId: number;
  tableId: number | null;
  equipmentIds: number[];
  attendanceMode: ScheduleAttendanceMode;
  isPublic: boolean;
  initialOccupiedSeats: number;
  capacity: number;
}

export interface ScheduleWebCreator {
  create(input: ScheduleWebCreateInput): Promise<ScheduleEventRecord>;
}

export interface ScheduleWebTelegramSender {
  sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
  sendGroupMessage?(
    chatId: number,
    message: string,
    options?: { parseMode?: 'HTML'; messageThreadId?: number },
  ): Promise<{ messageId: number } | void>;
  deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
  editMessageText?(input: {
    chatId: number;
    messageId: number;
    text: string;
    options?: { parseMode?: 'HTML' };
  }): Promise<void>;
}

export function createDatabaseScheduleWebCreator({
  database,
  config,
  telegramSender,
}: {
  database: DatabaseConnection;
  config: RuntimeConfig;
  telegramSender?: ScheduleWebTelegramSender;
}): ScheduleWebCreator {
  const scheduleRepository = createDatabaseScheduleRepository({ database: database.db });
  const metadataStorage = createDatabaseAppMetadataSessionStorage({ database: database.db });

  return {
    async create(input) {
      const created = await createScheduleEvent({
        repository: scheduleRepository,
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        organizerTelegramUserId: input.organizerTelegramUserId,
        createdByTelegramUserId: input.organizerTelegramUserId,
        tableId: input.tableId,
        equipmentIds: input.equipmentIds,
        attendanceMode: input.attendanceMode,
        isPublic: input.isPublic,
        initialOccupiedSeats: input.initialOccupiedSeats,
        capacity: input.capacity,
      });

      await appendAuditEvent({
        repository: createDatabaseAuditLogRepository({ database: database.db }),
        actorTelegramUserId: input.organizerTelegramUserId,
        actionKey: 'schedule.created',
        targetType: 'schedule-event',
        targetId: created.id,
        summary: `Actividad creada desde la web: ${created.title}`,
        details: {
          source: 'web',
          startsAt: created.startsAt,
          capacity: created.capacity,
          tableId: created.tableId,
          equipmentIds: created.equipmentIds ?? [],
        },
      });

      await ignorePostSaveFailure(() => synchronizeGoogleCalendarScheduleEvent({
        event: created,
        storage: metadataStorage,
        config: config.googleCalendar,
      }));

      if (telegramSender) {
        await ignorePostSaveFailure(() => notifyScheduleConflicts({
          eventId: created.id,
          actorTelegramUserId: input.organizerTelegramUserId,
          scheduleRepository,
          loadEvent: async (eventId) => {
            const event = await scheduleRepository.findEventById(eventId);
            if (!event) {
              throw new Error(`Schedule event ${eventId} not found`);
            }
            return event;
          },
          sendPrivateMessage: telegramSender.sendPrivateMessage.bind(telegramSender),
          botLanguage: config.bot.language,
        }));

        await ignorePostSaveFailure(async () => {
          const newsGroupRepository = createDatabaseNewsGroupRepository({ database: database.db });
          const dependencies = {
            change: { action: 'created' as const, event: created },
            ...(telegramSender.sendGroupMessage
              ? { sendGroupMessage: telegramSender.sendGroupMessage.bind(telegramSender) }
              : {}),
            ...(telegramSender.deleteMessage
              ? { deleteMessage: telegramSender.deleteMessage.bind(telegramSender) }
              : {}),
            ...(telegramSender.editMessageText
              ? { editMessageText: telegramSender.editMessageText.bind(telegramSender) }
              : {}),
            snapshotStorage: metadataStorage,
            newsGroupRepository,
            database: database.db,
            botLanguage: config.bot.language,
            scheduleRepository,
            venueEventRepository: createDatabaseVenueEventRepository({ database: database.db }),
            tableRepository: createDatabaseClubTableRepository({ database: database.db }),
            resolveActorDisplayName: async () => {
              const rows = await database.db
                .select({ displayName: users.displayName })
                .from(users)
                .where(eq(users.telegramUserId, input.organizerTelegramUserId));
              return rows[0]?.displayName ?? `Usuario ${input.organizerTelegramUserId}`;
            },
          };
          await publishCalendarSnapshotToNewsGroups(dependencies);
          await publishPublicCalendarSnapshotToNewsGroups(dependencies);
        });

        await ignorePostSaveFailure(() => telegramSender.sendPrivateMessage(
          input.organizerTelegramUserId,
          `Actividad creada desde el formulario web: ${created.title}`,
        ));
      }

      return created;
    },
  };
}

async function ignorePostSaveFailure(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // La actividad ya está guardada: los efectos externos no deben convertirla en un error aparente.
  }
}
