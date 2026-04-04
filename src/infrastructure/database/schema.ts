import { bigint, boolean, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

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
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
});
