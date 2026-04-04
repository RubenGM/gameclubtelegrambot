import {
  bigint,
  bigserial,
  boolean,
  integer,
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

export const scheduleEvents = pgTable('schedule_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
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
