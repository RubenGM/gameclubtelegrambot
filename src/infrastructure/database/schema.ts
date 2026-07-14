import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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

export const memberSignupRequests = pgTable(
  'member_signup_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    telegramAlias: varchar('telegram_alias', { length: 128 }),
    contact: varchar('contact', { length: 255 }).notNull(),
    message: text('message'),
    acceptedTerms: boolean('accepted_terms').notNull().default(false),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    source: varchar('source', { length: 32 }).notNull().default('web'),
    userAgent: text('user_agent'),
    remoteAddress: varchar('remote_address', { length: 128 }),
    notificationSummary: jsonb('notification_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    statusLookup: index('member_signup_requests_status_idx').on(table.status),
    createdLookup: index('member_signup_requests_created_at_idx').on(table.createdAt),
  }),
);

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
  ownerTelegramUserId: bigint('owner_telegram_user_id', { mode: 'number' }).references(() => users.telegramUserId),
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

export const catalogLoanReminders = pgTable(
  'catalog_loan_reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    loanId: bigint('loan_id', { mode: 'number' })
      .notNull()
      .references(() => catalogLoans.id),
    borrowerTelegramUserId: bigint('borrower_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    reminderKind: varchar('reminder_kind', { length: 32 }).notNull(),
    leadHours: integer('lead_hours').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueReminder: uniqueIndex('catalog_loan_reminders_unique_delivery').on(
      table.loanId,
      table.borrowerTelegramUserId,
      table.reminderKind,
      table.leadHours,
    ),
    loanLookup: index('catalog_loan_reminders_loan_id_idx').on(table.loanId),
    borrowerLookup: index('catalog_loan_reminders_borrower_telegram_user_id_idx').on(table.borrowerTelegramUserId),
  }),
);

export const scheduleEvents = pgTable(
  'schedule_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    detailsMessageChatId: bigint('details_message_chat_id', { mode: 'number' }),
    detailsMessageId: bigint('details_message_id', { mode: 'number' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(180),
    organizerTelegramUserId: bigint('organizer_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    tableId: bigint('table_id', { mode: 'number' }).references(() => clubTables.id),
    catalogItemId: bigint('catalog_item_id', { mode: 'number' }).references(() => catalogItems.id),
    attendanceMode: varchar('attendance_mode', { length: 16 }).notNull().default('open'),
    isPublic: boolean('is_public').notNull().default(false),
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
  },
  (table) => ({
    catalogItemLookup: index('schedule_events_catalog_item_id_idx').on(table.catalogItemId),
  }),
);

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

export const roleGames = pgTable(
  'role_games',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: varchar('type', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    title: varchar('title', { length: 255 }).notNull(),
    system: varchar('system', { length: 120 }).notNull(),
    description: text('description'),
    visibility: varchar('visibility', { length: 16 }).notNull().default('members'),
    publicJoinPolicy: varchar('public_join_policy', { length: 32 }).notNull().default('members_only'),
    entryMode: varchar('entry_mode', { length: 16 }).notNull().default('request'),
    acceptanceMode: varchar('acceptance_mode', { length: 24 }).notNull().default('manual_review'),
    capacity: integer('capacity').notNull(),
    primaryGmTelegramUserId: bigint('primary_gm_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    defaultDurationMinutes: integer('default_duration_minutes').notNull().default(180),
    defaultTableId: bigint('default_table_id', { mode: 'number' }).references(() => clubTables.id),
    defaultAttendanceMode: varchar('default_attendance_mode', { length: 16 }).notNull().default('closed'),
    defaultIsPublicScheduleEvent: boolean('default_is_public_schedule_event').notNull().default(false),
    autoAddConfirmedPlayers: boolean('auto_add_confirmed_players').notNull().default(false),
    allowPlayerManualScheduling: boolean('allow_player_manual_scheduling').notNull().default(false),
    schedulingMode: varchar('scheduling_mode', { length: 16 }).notNull().default('manual'),
    recurrenceRule: jsonb('recurrence_rule'),
    recurrenceWindowCount: integer('recurrence_window_count').notNull().default(0),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => ({
    statusLookup: index('role_games_status_idx').on(table.status),
    visibilityLookup: index('role_games_visibility_idx').on(table.visibility),
    primaryGmLookup: index('role_games_primary_gm_idx').on(table.primaryGmTelegramUserId),
  }),
);

export const roleGameMembers = pgTable(
  'role_game_members',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameId: bigint('role_game_id', { mode: 'number' })
      .notNull()
      .references(() => roleGames.id),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    role: varchar('role', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    isExternal: boolean('is_external').notNull().default(false),
    playerNote: text('player_note'),
    requestedByTelegramUserId: bigint('requested_by_telegram_user_id', { mode: 'number' }).references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    roleGameLookup: index('role_game_members_role_game_id_idx').on(table.roleGameId),
    telegramUserLookup: index('role_game_members_telegram_user_id_idx').on(table.telegramUserId),
    onePrimaryGm: uniqueIndex('role_game_members_one_primary_gm')
      .on(table.roleGameId)
      .where(sql`${table.role} = 'primary_gm' and ${table.status} in ('invited', 'requested', 'confirmed', 'waitlisted')`),
    oneActiveUserMembership: uniqueIndex('role_game_members_one_active_user_membership')
      .on(table.roleGameId, table.telegramUserId)
      .where(sql`${table.status} in ('invited', 'requested', 'confirmed', 'waitlisted')`),
  }),
);

export const roleGameCharacters = pgTable(
  'role_game_characters',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameId: bigint('role_game_id', { mode: 'number' })
      .notNull()
      .references(() => roleGames.id),
    assignedMemberId: bigint('assigned_member_id', { mode: 'number' })
      .references(() => roleGameMembers.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    externalUrl: varchar('external_url', { length: 2048 }),
    visibility: varchar('visibility', { length: 16 }).notNull(),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
  },
  (table) => ({
    roleGameLookup: index('role_game_characters_role_game_id_idx').on(table.roleGameId),
    assignedMemberLookup: index('role_game_characters_assigned_member_id_idx').on(table.assignedMemberId),
    visibilityLookup: index('role_game_characters_visibility_idx').on(table.visibility),
  }),
);

export const roleGameCharacterAttachments = pgTable(
  'role_game_character_attachments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    characterId: bigint('character_id', { mode: 'number' })
      .notNull()
      .references(() => roleGameCharacters.id),
    internalStorageEntryId: bigint('internal_storage_entry_id', { mode: 'number' })
      .notNull()
      .references(() => storageEntries.id),
    kind: varchar('kind', { length: 16 }).default('attachment').notNull(),
    visibility: varchar('visibility', { length: 16 }).notNull(),
    uploadedByTelegramUserId: bigint('uploaded_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedByTelegramUserId: bigint('removed_by_telegram_user_id', { mode: 'number' })
      .references(() => users.telegramUserId),
  },
  (table) => ({
    characterLookup: index('role_game_character_attachments_character_id_idx').on(table.characterId),
    storageEntryLookup: uniqueIndex('role_game_character_attachments_storage_entry_id_idx')
      .on(table.internalStorageEntryId),
    activeCharacterLookup: index('role_game_character_attachments_active_character_idx')
      .on(table.characterId)
      .where(sql`${table.removedAt} is null`),
    oneActivePortrait: uniqueIndex('role_game_character_attachments_one_active_portrait_idx')
      .on(table.characterId)
      .where(sql`${table.kind} = 'portrait' and ${table.removedAt} is null`),
  }),
);

export const roleGameCharacterClaimRequests = pgTable(
  'role_game_character_claim_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    characterId: bigint('character_id', { mode: 'number' })
      .notNull()
      .references(() => roleGameCharacters.id),
    requestedByMemberId: bigint('requested_by_member_id', { mode: 'number' })
      .notNull()
      .references(() => roleGameMembers.id),
    status: varchar('status', { length: 16 }).notNull().default('requested'),
    resolvedByTelegramUserId: bigint('resolved_by_telegram_user_id', { mode: 'number' })
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    characterLookup: index('role_game_character_claims_character_id_idx').on(table.characterId),
    requestedByMemberLookup: index('role_game_character_claims_member_id_idx').on(table.requestedByMemberId),
    statusLookup: index('role_game_character_claims_status_idx').on(table.status),
    onePendingRequestPerMember: uniqueIndex('role_game_character_claims_one_pending_idx')
      .on(table.characterId, table.requestedByMemberId)
      .where(sql`${table.status} = 'requested'`),
  }),
);

export const roleGameSessions = pgTable(
  'role_game_sessions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameId: bigint('role_game_id', { mode: 'number' })
      .notNull()
      .references(() => roleGames.id),
    scheduleEventId: bigint('schedule_event_id', { mode: 'number' })
      .notNull()
      .references(() => scheduleEvents.id),
    source: varchar('source', { length: 24 }).notNull(),
    generatedForStartsAt: timestamp('generated_for_starts_at', { withTimezone: true }),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    roleGameLookup: index('role_game_sessions_role_game_id_idx').on(table.roleGameId),
    scheduleEventLookup: uniqueIndex('role_game_sessions_schedule_event_id_idx').on(table.scheduleEventId),
  }),
);

export const roleGameMaterialCategories = pgTable(
  'role_game_material_categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameId: bigint('role_game_id', { mode: 'number' })
      .notNull()
      .references(() => roleGames.id, { onDelete: 'cascade' }),
    parentCategoryId: bigint('parent_category_id', { mode: 'number' })
      .references((): AnyPgColumn => roleGameMaterialCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    roleGameLookup: index('role_game_material_categories_role_game_id_idx').on(table.roleGameId),
    parentLookup: index('role_game_material_categories_parent_category_id_idx').on(table.parentCategoryId),
    uniqueSiblingName: uniqueIndex('role_game_material_categories_sibling_name_unique').on(table.roleGameId, table.parentCategoryId, table.name),
  }),
);

export const roleGameMaterials = pgTable(
  'role_game_materials',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameId: bigint('role_game_id', { mode: 'number' })
      .notNull()
      .references(() => roleGames.id),
    categoryId: bigint('category_id', { mode: 'number' })
      .references(() => roleGameMaterialCategories.id, { onDelete: 'set null' }),
    internalStorageEntryId: bigint('internal_storage_entry_id', { mode: 'number' })
      .notNull()
      .references(() => storageEntries.id),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    visibility: varchar('visibility', { length: 16 }).notNull(),
    deliveryState: varchar('delivery_state', { length: 16 }).notNull().default('not_sent'),
    uploadedByTelegramUserId: bigint('uploaded_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
  },
  (table) => ({
    roleGameLookup: index('role_game_materials_role_game_id_idx').on(table.roleGameId),
    categoryLookup: index('role_game_materials_category_id_idx').on(table.categoryId),
    internalStorageEntryLookup: uniqueIndex('role_game_materials_internal_storage_entry_id_idx').on(table.internalStorageEntryId),
  }),
);

export const roleGameMaterialDeliveries = pgTable(
  'role_game_material_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    roleGameMaterialId: bigint('role_game_material_id', { mode: 'number' })
      .notNull()
      .references(() => roleGameMaterials.id),
    recipientTelegramUserId: bigint('recipient_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    sentByTelegramUserId: bigint('sent_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    deliveryMode: varchar('delivery_mode', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    materialLookup: index('role_game_material_deliveries_material_id_idx').on(table.roleGameMaterialId),
    recipientLookup: index('role_game_material_deliveries_recipient_telegram_user_id_idx').on(table.recipientTelegramUserId),
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
    messageThreadId: integer('message_thread_id').notNull().default(0),
    categoryKey: varchar('category_key', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSubscription: uniqueIndex('news_group_subscriptions_unique_subscription').on(
      table.chatId,
      table.categoryKey,
      table.messageThreadId,
    ),
    categoryLookup: index('news_group_subscriptions_category_key_idx').on(table.categoryKey),
  }),
);

export const notices = pgTable(
  'notices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    creatorDisplayName: varchar('creator_display_name', { length: 255 }).notNull(),
    text: text('text').notNull(),
    textHtml: text('text_html'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedByTelegramUserId: bigint('archived_by_telegram_user_id', { mode: 'number' }).references(() => users.telegramUserId),
    archiveReason: text('archive_reason'),
  },
  (table) => ({
    statusLookup: index('notices_status_idx').on(table.status),
    creatorLookup: index('notices_created_by_telegram_user_id_idx').on(table.createdByTelegramUserId),
    expiresAtLookup: index('notices_expires_at_idx').on(table.expiresAt),
    createdAtLookup: index('notices_created_at_idx').on(table.createdAt),
  }),
);

export const noticeAttachments = pgTable(
  'notice_attachments',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    noticeId: bigint('notice_id', { mode: 'number' })
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    sourceChatId: bigint('source_chat_id', { mode: 'number' }).notNull(),
    sourceMessageId: integer('source_message_id').notNull(),
    attachmentKind: varchar('attachment_kind', { length: 16 }).notNull(),
    telegramFileId: text('telegram_file_id'),
    telegramFileUniqueId: text('telegram_file_unique_id'),
    caption: text('caption'),
    originalFileName: text('original_file_name'),
    mimeType: text('mime_type'),
    fileSizeBytes: integer('file_size_bytes'),
    mediaGroupId: varchar('media_group_id', { length: 128 }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    noticeLookup: index('notice_attachments_notice_id_idx').on(table.noticeId),
  }),
);

export const noticePublications = pgTable(
  'notice_publications',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    noticeId: bigint('notice_id', { mode: 'number' })
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    messageThreadId: integer('message_thread_id').notNull().default(0),
    messageId: integer('message_id').notNull(),
    publicationKind: varchar('publication_kind', { length: 16 }).notNull(),
    attachmentId: bigint('attachment_id', { mode: 'number' }).references(() => noticeAttachments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    noticeLookup: index('notice_publications_notice_id_idx').on(table.noticeId),
    destinationLookup: index('notice_publications_destination_idx').on(table.chatId, table.messageThreadId),
    uniqueMessage: uniqueIndex('notice_publications_message_unique').on(table.chatId, table.messageId),
  }),
);

export const groupPurchases = pgTable(
  'group_purchases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    detailsMessageChatId: bigint('details_message_chat_id', { mode: 'number' }),
    detailsMessageId: bigint('details_message_id', { mode: 'number' }),
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

export const groupPurchaseReminders = pgTable(
  'group_purchase_reminders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    purchaseId: bigint('purchase_id', { mode: 'number' })
      .notNull()
      .references(() => groupPurchases.id),
    participantTelegramUserId: bigint('participant_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    reminderKind: varchar('reminder_kind', { length: 32 }).notNull(),
    leadHours: integer('lead_hours').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueReminder: uniqueIndex('group_purchase_reminders_unique_delivery').on(
      table.purchaseId,
      table.participantTelegramUserId,
      table.reminderKind,
      table.leadHours,
    ),
    purchaseLookup: index('group_purchase_reminders_purchase_id_idx').on(table.purchaseId),
    participantLookup: index('group_purchase_reminders_participant_telegram_user_id_idx').on(table.participantTelegramUserId),
  }),
);

export const lfgPlayerAds = pgTable(
  'lfg_player_ads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    telegramUserId: bigint('telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => ({
    statusLookup: index('lfg_player_ads_status_idx').on(table.status),
    userLookup: index('lfg_player_ads_telegram_user_id_idx').on(table.telegramUserId),
    updatedAtLookup: index('lfg_player_ads_updated_at_idx').on(table.updatedAt),
    oneActivePerUser: uniqueIndex('lfg_player_ads_one_active_per_user')
      .on(table.telegramUserId)
      .where(sql`${table.status} = 'active'`),
  }),
);

export const lfgGroupAds = pgTable(
  'lfg_group_ads',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    createdByTelegramUserId: bigint('created_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    creatorDisplayName: varchar('creator_display_name', { length: 255 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    seatsAvailable: integer('seats_available'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => ({
    statusLookup: index('lfg_group_ads_status_idx').on(table.status),
    creatorLookup: index('lfg_group_ads_created_by_telegram_user_id_idx').on(table.createdByTelegramUserId),
    updatedAtLookup: index('lfg_group_ads_updated_at_idx').on(table.updatedAt),
  }),
);

export const storageCategories = pgTable(
  'storage_categories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    slug: varchar('slug', { length: 128 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    parentCategoryId: bigint('parent_category_id', { mode: 'number' }).references((): AnyPgColumn => storageCategories.id),
    description: text('description'),
    storageChatId: bigint('storage_chat_id', { mode: 'number' }).notNull(),
    storageThreadId: integer('storage_thread_id').notNull(),
    categoryPurpose: varchar('category_purpose', { length: 32 }).notNull().default('user_uploads'),
    lifecycleStatus: varchar('lifecycle_status', { length: 16 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    uniqueSlug: uniqueIndex('storage_categories_slug_unique').on(table.slug),
    uniqueTopic: uniqueIndex('storage_categories_storage_topic_unique').on(table.storageChatId, table.storageThreadId),
    lifecycleLookup: index('storage_categories_lifecycle_status_idx').on(table.lifecycleStatus),
    parentLookup: index('storage_categories_parent_category_id_idx').on(table.parentCategoryId),
    purposeLookup: index('storage_categories_category_purpose_idx').on(table.categoryPurpose),
  }),
);

export const storageEntries = pgTable(
  'storage_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => storageCategories.id, { onDelete: 'cascade' }),
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
      .references(() => storageEntries.id, { onDelete: 'cascade' }),
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

export const storageCategorySubscriptions = pgTable(
  'storage_category_subscriptions',
  {
    telegramUserId: bigint('telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    categoryId: bigint('category_id', { mode: 'number' })
      .notNull()
      .references(() => storageCategories.id, { onDelete: 'cascade' }),
    includeSubcategories: boolean('include_subcategories').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueSubscription: uniqueIndex('storage_category_subscriptions_unique_subscription').on(
      table.telegramUserId,
      table.categoryId,
    ),
    categoryLookup: index('storage_category_subscriptions_category_id_idx').on(table.categoryId),
    userLookup: index('storage_category_subscriptions_telegram_user_id_idx').on(table.telegramUserId),
  }),
);

export const printJobs = pgTable(
  'print_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    requestedByTelegramUserId: bigint('requested_by_telegram_user_id', { mode: 'number' })
      .notNull()
      .references(() => users.telegramUserId),
    requestedByDisplayName: varchar('requested_by_display_name', { length: 255 }).notNull(),
    origin: varchar('origin', { length: 32 }).notNull(),
    storageEntryId: bigint('storage_entry_id', { mode: 'number' }).references(() => storageEntries.id),
    storageMessageId: bigint('storage_message_id', { mode: 'number' }).references(() => storageEntryMessages.id),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type'),
    detectedType: varchar('detected_type', { length: 32 }).notNull(),
    normalizedPageCount: integer('normalized_page_count').notNull(),
    selectedPagesLabel: varchar('selected_pages_label', { length: 255 }).notNull(),
    selectedPageCount: integer('selected_page_count').notNull(),
    copies: integer('copies').notNull(),
    pagesPerSheet: integer('pages_per_sheet').notNull().default(1),
    estimatedPhysicalPages: integer('estimated_physical_pages').notNull(),
    sides: varchar('sides', { length: 32 }).notNull(),
    cupsQueue: varchar('cups_queue', { length: 255 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('prepared'),
    cupsJobId: varchar('cups_job_id', { length: 128 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    createdAtLookup: index('print_jobs_created_at_idx').on(table.createdAt),
    requesterLookup: index('print_jobs_requested_by_telegram_user_id_idx').on(table.requestedByTelegramUserId),
    statusLookup: index('print_jobs_status_idx').on(table.status),
  }),
);
