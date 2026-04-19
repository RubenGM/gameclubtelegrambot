import { getScheduleTableCapacityAdvisories, resolveScheduleTableReference } from '../schedule/schedule-table-selection.js';
import type { ScheduleEventRecord } from '../schedule/schedule-catalog.js';
import type { ClubTableRecord, ClubTableRepository } from '../tables/table-catalog.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { asNullableNumber, asNullableString, buildStartsAt } from './schedule-parsing.js';
import { escapeHtml, formatDurationMinutes, formatTimestamp } from './schedule-presentation.js';

export async function formatScheduleDraftSummary({
  botLanguage,
  data,
  eventOrOrganizer,
  organizerTelegramUserId,
  selectedTable,
  tableRepository,
  resolveOrganizerDisplayName,
}: {
  botLanguage?: string;
  data: Record<string, unknown>;
  eventOrOrganizer?: ScheduleEventRecord | number;
  organizerTelegramUserId?: number;
  selectedTable?: ClubTableRecord | null;
  tableRepository: ClubTableRepository;
  resolveOrganizerDisplayName: (telegramUserId: number) => Promise<string>;
}): Promise<string> {
  const texts = createTelegramI18n(normalizeBotLanguage(botLanguage, 'ca')).schedule;
  const event = typeof eventOrOrganizer === 'object' && eventOrOrganizer !== null && 'startsAt' in eventOrOrganizer ? eventOrOrganizer : null;
  const effectiveOrganizerTelegramUserId = typeof eventOrOrganizer === 'number' ? eventOrOrganizer : organizerTelegramUserId;
  const title = String(data.title ?? event?.title ?? '');
  const description = data.description === undefined ? event?.description ?? null : asNullableString(data.description);
  const date = String(data.date ?? event?.startsAt.slice(0, 10) ?? '');
  const time = String(data.time ?? event?.startsAt.slice(11, 16) ?? '');
  const durationMinutes = Number(data.durationMinutes ?? event?.durationMinutes ?? 0);
  const capacity = Number(data.capacity ?? event?.capacity ?? 0);
  const effectiveTableId = data.tableId === undefined ? event?.tableId ?? null : asNullableNumber(data.tableId);

  const table = selectedTable === undefined
    ? await resolveScheduleTableReference({
        repository: tableRepository,
        tableId: effectiveTableId,
      })
    : selectedTable;
  const advisories = getScheduleTableCapacityAdvisories({
    table,
    requestedCapacity: capacity,
  });

  return [
    `${texts.editFieldTitle}: ${escapeHtml(title)}`,
    `${texts.detailsDescription}: ${escapeHtml(description ?? texts.noDescription)}`,
    `${texts.detailsStart}: ${formatTimestamp(buildStartsAt(date, time))}`,
    `${texts.detailsDuration}: ${formatDurationMinutes(durationMinutes)}`,
    `${texts.detailsSeats}: ${capacity}`,
    `${texts.detailsTable}: ${table?.displayName ?? texts.noTable}`,
    ...advisories.map(escapeHtml),
    ...(effectiveOrganizerTelegramUserId
      ? [`${texts.detailsOrganizer}: ${escapeHtml(await resolveOrganizerDisplayName(effectiveOrganizerTelegramUserId))}`]
      : []),
  ].join('\n');
}
