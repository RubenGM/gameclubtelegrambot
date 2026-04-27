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
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
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
  attendanceMode: varchar('attendance_mode', { length: 16 }).notNull().default('open'),
  initialOccupiedSeats: integer('initial_occupied_seats').notNull().default(0),
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
    reminderLeadHours: integer('reminder_lead_hours'),
    reminderPreferenceConfigured: boolean('reminder_preference_configured').notNull().default(false),
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

export const scheduleEventReminders = pgTable(
  'schedule_event_reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scheduleEventId: bigint('schedule_event_id', { mode: 'number' })
      .notNull()
      .references(() => scheduleEvents.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    leadHours: integer('lead_hours').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueReminder: uniqueIndex('schedule_event_reminders_unique_delivery').on(
      table.scheduleEventId,
      table.participantTelegramUserId,
      table.leadHours,
    ),
    eventLookup: index('schedule_event_reminders_schedule_event_id_idx').on(table.scheduleEventId),
    participantLookup: index('schedule_event_reminders_participant_telegram_user_id_idx').on(table.participantTelegramUserId),
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

export const groupPurchases = pgTable(
  'group_purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    purchaseMode: varchar('purchase_mode', { length: 16 }).notNull(),
    lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('open'),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    joinDeadlineAt: timestamp('join_deadline_at', { withTimezone: true }),
    confirmDeadlineAt: timestamp('confirm_deadline_at', { withTimezone: true }),
    totalPriceCents: integer('total_price_cents'),
    unitPriceCents: integer('unit_price_cents'),
    unitLabel: varchar('unit_label', { length: 64 }),
    allocationFieldKey: varchar('allocation_field_key', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => ({
    lifecycleLookup: index('group_purchases_lifecycle_status_idx').on(table.lifecycleStatus),
    creatorLookup: index('group_purchases_created_by_telegram_user_id_idx').on(table.createdByTelegramUserId),
    joinDeadlineLookup: index('group_purchases_join_deadline_at_idx').on(table.joinDeadlineAt),
    confirmDeadlineLookup: index('group_purchases_confirm_deadline_at_idx').on(table.confirmDeadlineAt),
  }),
);

export const groupPurchaseFields = pgTable(
  'group_purchase_fields',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchases.id),
    fieldKey: varchar('field_key', { length: 128 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    fieldType: varchar('field_type', { length: 32 }).notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    config: jsonb('config'),
    affectsQuantity: boolean('affects_quantity').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    purchaseLookup: index('group_purchase_fields_purchase_id_idx').on(table.purchaseId),
    uniqueFieldKey: uniqueIndex('group_purchase_fields_purchase_field_key_unique').on(table.purchaseId, table.fieldKey),
  }),
);

export const groupPurchaseParticipants = pgTable(
  'group_purchase_participants',
  {
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchases.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    status: varchar('status', { length: 16 }).notNull().default('interested'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => ({
    uniqueParticipant: uniqueIndex('group_purchase_participants_purchase_user_unique').on(
      table.purchaseId,
      table.participantTelegramUserId,
    ),
    purchaseLookup: index('group_purchase_participants_purchase_id_idx').on(table.purchaseId),
    statusLookup: index('group_purchase_participants_status_idx').on(table.status),
  }),
);

export const groupPurchaseParticipantFieldValues = pgTable(
  'group_purchase_participant_field_values',
  {
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchases.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    fieldId: bigint('field_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchaseFields.id),
    value: jsonb('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueValue: uniqueIndex('group_purchase_participant_field_values_unique').on(
      table.purchaseId,
      table.participantTelegramUserId,
      table.fieldId,
    ),
    purchaseLookup: index('group_purchase_participant_field_values_purchase_id_idx').on(table.purchaseId),
  }),
);

export const groupPurchaseMessages = pgTable(
  'group_purchase_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchases.id),
    authorTelegramUserId: bigint('author_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    purchaseLookup: index('group_purchase_messages_purchase_id_idx').on(table.purchaseId),
  }),
);

export const storageCategories = pgTable(
  'storage_categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: varchar('slug', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    storageChatId: bigint('storage_chat_id', { mode: 'number' }).notNull(),
    storageThreadId: integer('storage_thread_id').notNull(),
    lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    uniqueSlug: uniqueIndex('storage_categories_slug_unique').on(table.slug),
    uniqueTopic: uniqueIndex('storage_categories_storage_topic_unique').on(table.storageChatId, table.storageThreadId),
    lifecycleLookup: index('storage_categories_lifecycle_status_idx').on(table.lifecycleStatus),
  }),
);

export const storageEntries = pgTable(
  'storage_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => storageCategories.id),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    sourceKind: varchar('source_kind', { length: 16 }).notNull(),
    description: text('description'),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByTelegramUserId: bigint('deleted_by_telegram_user_id', { mode: 'number' }).references(() => users.telegramUserId),
  },
  (table) => ({
    categoryLookup: index('storage_entries_category_id_idx').on(table.categoryId),
    lifecycleLookup: index('storage_entries_lifecycle_status_idx').on(table.lifecycleStatus),
    creatorLookup: index('storage_entries_created_by_telegram_user_id_idx').on(table.createdByTelegramUserId),
  }),
);

export const storageEntryMessages = pgTable(
  'storage_entry_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    entryId: bigint('entry_id', { mode: 'number' })
      .notNull()
      .references(() => storageEntries.id),
    storageChatId: bigint('storage_chat_id', { mode: 'number' }).notNull(),
    storageMessageId: integer('storage_message_id').notNull(),
    storageThreadId: integer('storage_thread_id').notNull(),
    telegramFileId: text('telegram_file_id'),
    telegramFileUniqueId: text('telegram_file_unique_id'),
    attachmentKind: varchar('attachment_kind', { length: 16 }).notNull(),
    caption: text('caption'),
    originalFileName: text('original_file_name'),
    mimeType: text('mime_type'),
    fileSizeBytes: integer('file_size_bytes'),
    mediaGroupId: varchar('media_group_id', { length: 128 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    entryLookup: index('storage_entry_messages_entry_id_idx').on(table.entryId),
    uniqueMessage: uniqueIndex('storage_entry_messages_storage_message_unique').on(table.storageChatId, table.storageMessageId),
    fileLookup: index('storage_entry_messages_telegram_file_unique_id_idx').on(table.telegramFileUniqueId),
  }),
);
