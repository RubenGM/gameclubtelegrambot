import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const appMetadata = pgTable('app_metadata', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).primaryKey(),
  username: varchar('username', { length: 64 }),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  isApproved: boolean('is_approved').notNull().default(false),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  blockedAt: timestamp('blocked_at', { withTimezone: true }),
  statusReason: text('status_reason'),
});

export const userPermissionAssignments = pgTable(
  'user_permission_assignments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    subjectTelegramUserId: bigint('subject_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    permissionKey: varchar('permission_key', { length: 128 }).notNull(),
    scopeType: varchar('scope_type', { length: 16 }).notNull(),
    resourceType: varchar('resource_type', { length: 64 }),
    resourceId: varchar('resource_id', { length: 128 }),
    effect: varchar('effect', { length: 8 }).notNull(),
    grantedByTelegramUserId: bigint('granted_by_telegram_user_id', { mode: 'number' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assignmentKey: uniqueIndex('user_permission_assignments_unique_assignment').on(
      table.subjectTelegramUserId,
      table.permissionKey,
      table.scopeType,
      table.resourceType,
      table.resourceId,
    ),
  }),
);

export const userPermissionAuditLog = pgTable('user_permission_audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  subjectTelegramUserId: bigint('subject_telegram_user_id', { mode: 'number' }).notNull(),
  permissionKey: varchar('permission_key', { length: 128 }).notNull(),
  scopeType: varchar('scope_type', { length: 16 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }),
  resourceId: varchar('resource_id', { length: 128 }),
  previousEffect: varchar('previous_effect', { length: 8 }),
  nextEffect: varchar('next_effect', { length: 8 }),
  changedByTelegramUserId: bigint('changed_by_telegram_user_id', { mode: 'number' }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userStatusAuditLog = pgTable('user_status_audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  subjectTelegramUserId: bigint('subject_telegram_user_id', { mode: 'number' }).notNull(),
  previousStatus: varchar('previous_status', { length: 16 }),
  nextStatus: varchar('next_status', { length: 16 }).notNull(),
  changedByTelegramUserId: bigint('changed_by_telegram_user_id', { mode: 'number' }).notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorTelegramUserId: bigint('actor_telegram_user_id', { mode: 'number' }),
  actionKey: varchar('action_key', { length: 128 }).notNull(),
  targetType: varchar('target_type', { length: 64 }).notNull(),
  targetId: varchar('target_id', { length: 128 }).notNull(),
  summary: text('summary').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const clubTables = pgTable('club_tables', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  recommendedCapacity: integer('recommended_capacity'),
  lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

export const catalogFamilies = pgTable('catalog_families', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  familyKind: varchar('family_kind', { length: 32 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const catalogGroups = pgTable('catalog_groups', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  familyId: bigint('family_id', { mode: 'number' }).references(() => catalogFamilies.id),
  slug: varchar('slug', { length: 128 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const catalogItems = pgTable('catalog_items', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  familyId: bigint('family_id', { mode: 'number' }).references(() => catalogFamilies.id),
  groupId: bigint('group_id', { mode: 'number' }).references(() => catalogGroups.id),
  itemType: varchar('item_type', { length: 32 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  originalName: varchar('original_name', { length: 255 }),
  description: text('description'),
  language: varchar('language', { length: 64 }),
  publisher: varchar('publisher', { length: 255 }),
  publicationYear: integer('publication_year'),
  playerCountMin: integer('player_count_min'),
  playerCountMax: integer('player_count_max'),
  recommendedAge: integer('recommended_age'),
  playTimeMinutes: integer('play_time_minutes'),
  externalRefs: jsonb('external_refs'),
  metadata: jsonb('metadata'),
  lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
});

export const catalogMedia = pgTable('catalog_media', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  familyId: bigint('family_id', { mode: 'number' }).references(() => catalogFamilies.id),
  itemId: bigint('item_id', { mode: 'number' }).references(() => catalogItems.id),
  mediaType: varchar('media_type', { length: 32 }).notNull(),
  url: text('url').notNull(),
  altText: text('alt_text'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const catalogLoans = pgTable(
  'catalog_loans',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    itemId: bigint('item_id', { mode: 'number' })
      .notNull()
      .references(() => catalogItems.id),
    borrowerTelegramUserId: bigint('borrower_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    borrowerDisplayName: varchar('borrower_display_name', { length: 255 }).notNull(),
    loanedByTelegramUserId: bigint('loaned_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    dueAt: timestamp('due_at', { withTimezone: true }),
    notes: text('notes'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedByTelegramUserId: bigint('returned_by_telegram_user_id', { mode: 'number' }).references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    itemLookup: index('catalog_loans_item_id_idx').on(table.itemId),
    borrowerLookup: index('catalog_loans_borrower_telegram_user_id_idx').on(table.borrowerTelegramUserId),
    oneActivePerItem: uniqueIndex('catalog_loans_one_active_per_item').on(table.itemId).where(sql`${table.returnedAt} is null`),
  }),
);

export const scheduleEvents = pgTable('schedule_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  durationMinutes: integer('duration_minutes').notNull().default(180),
  organizerTelegramUserId: bigint('organizer_telegram_user_id', { mode: 'number' })
    .notNull()
    .references(() => users.telegramUserId),
  createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
    .notNull()
    .references(() => users.telegramUserId),
  tableId: bigint('table_id', { mode: 'number' }).references(() => clubTables.id),
  capacity: integer('capacity').notNull(),
  lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledByTelegramUserId: bigint('cancelled_by_telegram_user_id', { mode: 'number' }).references(
    () => users.telegramUserId,
  ),
  cancellationReason: text('cancellation_reason'),
});

export const scheduleEventParticipants = pgTable(
  'schedule_event_participants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scheduleEventId: bigint('schedule_event_id', { mode: 'number' })
      .notNull()
      .references(() => scheduleEvents.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    addedByTelegramUserId: bigint('added_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    removedByTelegramUserId: bigint('removed_by_telegram_user_id', { mode: 'number' }).references(
      () => users.telegramUserId,
    ),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (table) => ({
    participantPerEvent: uniqueIndex('schedule_event_participants_unique_participant').on(
      table.scheduleEventId,
      table.participantTelegramUserId,
    ),
  }),
);

export const venueEvents = pgTable('venue_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  occupancyScope: varchar('occupancy_scope', { length: 16 }).notNull(),
  impactLevel: varchar('impact_level', { length: 16 }).notNull(),
  lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('scheduled'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancellationReason: text('cancellation_reason'),
});

export const newsGroups = pgTable(
  'news_groups',
  {
    chatId: bigint('chat_id', { mode: 'number' }).primaryKey(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    enabledLookup: index('news_groups_is_enabled_idx').on(table.isEnabled),
  }),
);

export const newsGroupSubscriptions = pgTable(
  'news_group_subscriptions',
  {
    chatId: bigint('chat_id', { mode: 'number' })
      .notNull()
      .references(() => newsGroups.chatId),
    categoryKey: varchar('category_key', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSubscription: uniqueIndex('news_group_subscriptions_unique_subscription').on(
      table.chatId,
      table.categoryKey,
    ),
    categoryLookup: index('news_group_subscriptions_category_key_idx').on(table.categoryKey),
  }),
);
