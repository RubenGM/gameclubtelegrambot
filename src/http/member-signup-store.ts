import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { memberSignupRequests } from '../infrastructure/database/schema.js';

export interface MemberSignupInput {
  fullName: string;
  telegramAlias: string | null;
  contact: string;
  message: string | null;
  acceptedTerms: boolean;
  userAgent: string | null;
  remoteAddress: string | null;
}

export interface MemberSignupRecord extends MemberSignupInput {
  id: number;
  status: string;
  source: string;
  notificationSummary: Record<string, unknown> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  resolvedAt: Date | string | null;
}

export interface MemberSignupStore {
  create(input: MemberSignupInput): Promise<MemberSignupRecord>;
  updateNotificationSummary(id: number, summary: Record<string, unknown>): Promise<void>;
}

export function createDatabaseMemberSignupStore({
  database,
}: {
  database: NodePgDatabase;
}): MemberSignupStore {
  return {
    async create(input) {
      const [row] = await database
        .insert(memberSignupRequests)
        .values({
          fullName: input.fullName,
          telegramAlias: input.telegramAlias,
          contact: input.contact,
          message: input.message,
          acceptedTerms: input.acceptedTerms,
          source: 'web',
          userAgent: input.userAgent,
          remoteAddress: input.remoteAddress,
        })
        .returning();

      if (!row) {
        throw new Error('Member signup request was not returned');
      }

      return {
        id: row.id,
        fullName: row.fullName,
        telegramAlias: row.telegramAlias,
        contact: row.contact,
        message: row.message,
        acceptedTerms: row.acceptedTerms,
        status: row.status,
        source: row.source,
        userAgent: row.userAgent,
        remoteAddress: row.remoteAddress,
        notificationSummary: row.notificationSummary as Record<string, unknown> | null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt,
      };
    },
    async updateNotificationSummary(id, summary) {
      await database
        .update(memberSignupRequests)
        .set({
          notificationSummary: summary,
          updatedAt: new Date(),
        })
        .where(eq(memberSignupRequests.id, id));
    },
  };
}
