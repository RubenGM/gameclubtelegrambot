import { appendAuditEvent, type AuditLogAppendInput } from '../audit/audit-log.js';
import { normalizeDisplayName } from './display-name.js';

export type MembershipUserStatus = 'pending' | 'approved' | 'blocked';

export interface MembershipUserRecord {
  telegramUserId: number;
  username?: string | null;
  displayName: string;
  status: MembershipUserStatus;
  isAdmin: boolean;
}

export interface MembershipAccessRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<MembershipUserRecord | null>;
  syncUserProfile(input: {
    telegramUserId: number;
    username?: string | null;
    displayName: string;
  }): Promise<MembershipUserRecord | null>;
  backfillDisplayNames(): Promise<number>;
  upsertPendingUser(input: {
    telegramUserId: number;
    username?: string | null;
    displayName: string;
  }): Promise<MembershipUserRecord>;
  listPendingUsers(): Promise<MembershipUserRecord[]>;
  updateUserStatus(input: {
    telegramUserId: number;
    status: MembershipUserStatus;
    changedByTelegramUserId: number;
    isAdmin?: boolean;
    reason?: string | null;
  }): Promise<MembershipUserRecord>;
  appendStatusAuditLog(input: {
    telegramUserId: number;
    previousStatus: MembershipUserStatus | null;
    nextStatus: MembershipUserStatus;
    changedByTelegramUserId: number;
    reason?: string | null;
  }): Promise<void>;
  appendAuditEvent(input: AuditLogAppendInput): Promise<void>;
}

export async function requestMembershipAccess({
  repository,
  telegramUserId,
  username,
  displayName,
}: {
  repository: MembershipAccessRepository;
  telegramUserId: number;
  username?: string | null;
  displayName: string;
}): Promise<{ outcome: 'created' | 'already-pending' | 'already-approved' | 'blocked'; message: string }> {
  await repository.syncUserProfile({
    telegramUserId,
    ...(username !== undefined ? { username } : {}),
    displayName,
  });

  const existing = await repository.findUserByTelegramUserId(telegramUserId);

  if (existing?.status === 'approved') {
    return {
      outcome: 'already-approved',
      message: 'Ja tens accés aprovat. Pots utilitzar les funcionalitats normals del bot.',
    };
  }

  if (existing?.status === 'blocked') {
    return {
      outcome: 'blocked',
      message: 'El teu accés esta blocat. Contacta amb l administracio del club si necessites revisio.',
    };
  }

  if (existing?.status === 'pending') {
    return {
      outcome: 'already-pending',
      message:
        'Ja hem rebut la teva sollicitud d acces. Ara avisa un administrador del club perque l aprovi i podras fer servir activitats, calendari, cataleg i taules.',
    };
  }

  await repository.upsertPendingUser({
    telegramUserId,
    ...(username !== undefined ? { username: normalizeDisplayName(username) } : {}),
    displayName: normalizeDisplayName(displayName) ?? 'Usuari',
  });
  await repository.appendStatusAuditLog({
    telegramUserId,
    previousStatus: null,
    nextStatus: 'pending',
    changedByTelegramUserId: telegramUserId,
    reason: 'member-access-request',
  });

  return {
    outcome: 'created',
    message:
      'Ja hem rebut la teva sollicitud d acces. Ara avisa un administrador del club perque l aprovi i podras fer servir activitats, calendari, cataleg i taules.',
  };
}

export async function listPendingMembershipRequests({
  repository,
}: {
  repository: MembershipAccessRepository;
}): Promise<{ pendingUsers: MembershipUserRecord[] }> {
  return {
    pendingUsers: await repository.listPendingUsers(),
  };
}

export async function approveMembershipRequest({
  repository,
  applicantTelegramUserId,
  adminTelegramUserId,
}: {
  repository: MembershipAccessRepository;
  applicantTelegramUserId: number;
  adminTelegramUserId: number;
}): Promise<{
  outcome: 'approved' | 'already-approved' | 'missing' | 'blocked';
  applicantMessage: string;
  adminMessage: string;
}> {
  const existing = await repository.findUserByTelegramUserId(applicantTelegramUserId);

  if (!existing) {
    return {
      outcome: 'missing',
      applicantMessage: 'No s ha trobat cap sollicitud per a aquest usuari.',
      adminMessage: 'No hi ha cap sollicitud pendent per aquest usuari.',
    };
  }

  if (existing.status === 'approved') {
    return {
      outcome: 'already-approved',
      applicantMessage: 'Ja tens accés aprovat al club.',
      adminMessage: 'Aquest usuari ja estava aprovat.',
    };
  }

  if (existing.status === 'blocked') {
    return {
      outcome: 'blocked',
      applicantMessage: 'No s ha pogut aprovar la teva sollicitud perquè el compte esta blocat.',
      adminMessage: 'Aquest usuari esta blocat i no es pot aprovar directament.',
    };
  }

  await repository.updateUserStatus({
    telegramUserId: applicantTelegramUserId,
    status: 'approved',
    changedByTelegramUserId: adminTelegramUserId,
  });
  await repository.appendStatusAuditLog({
    telegramUserId: applicantTelegramUserId,
    previousStatus: existing.status,
    nextStatus: 'approved',
    changedByTelegramUserId: adminTelegramUserId,
    reason: 'member-access-approved',
  });
  await appendAuditEvent({
    repository: { appendEvent: repository.appendAuditEvent },
    actorTelegramUserId: adminTelegramUserId,
    actionKey: 'membership.approved',
    targetType: 'membership-user',
    targetId: applicantTelegramUserId,
    summary: 'Usuari aprovat correctament',
    details: {
      previousStatus: existing.status,
      nextStatus: 'approved',
    },
  });

  return {
    outcome: 'approved',
    applicantMessage: 'La teva sollicitud ha estat aprovada. Ja pots utilitzar les funcionalitats del club.',
    adminMessage: 'Usuari aprovat correctament.',
  };
}

export async function rejectMembershipRequest({
  repository,
  applicantTelegramUserId,
  adminTelegramUserId,
  reason,
}: {
  repository: MembershipAccessRepository;
  applicantTelegramUserId: number;
  adminTelegramUserId: number;
  reason?: string | null;
}): Promise<{
  outcome: 'blocked' | 'already-blocked' | 'missing' | 'already-approved';
  applicantMessage: string;
  adminMessage: string;
}> {
  const existing = await repository.findUserByTelegramUserId(applicantTelegramUserId);

  if (!existing) {
    return {
      outcome: 'missing',
      applicantMessage: 'No s ha trobat cap sollicitud per a aquest usuari.',
      adminMessage: 'No hi ha cap sollicitud pendent per aquest usuari.',
    };
  }

  if (existing.status === 'approved') {
    return {
      outcome: 'already-approved',
      applicantMessage: 'Aquest usuari ja esta aprovat.',
      adminMessage: 'Aquest usuari ja estava aprovat.',
    };
  }

  if (existing.status === 'blocked') {
    return {
      outcome: 'already-blocked',
      applicantMessage: 'El teu accés continua blocat.',
      adminMessage: 'Aquest usuari ja estava blocat.',
    };
  }

  await repository.updateUserStatus({
    telegramUserId: applicantTelegramUserId,
    status: 'blocked',
    changedByTelegramUserId: adminTelegramUserId,
    ...(reason !== undefined ? { reason } : {}),
  });
  await repository.appendStatusAuditLog({
    telegramUserId: applicantTelegramUserId,
    previousStatus: existing.status,
    nextStatus: 'blocked',
    changedByTelegramUserId: adminTelegramUserId,
    reason: reason ?? 'member-access-rejected',
  });
  await appendAuditEvent({
    repository: { appendEvent: repository.appendAuditEvent },
    actorTelegramUserId: adminTelegramUserId,
    actionKey: 'membership.rejected',
    targetType: 'membership-user',
    targetId: applicantTelegramUserId,
    summary: 'Sollicitud d acces rebutjada',
    details: {
      previousStatus: existing.status,
      nextStatus: 'blocked',
      reason: reason ?? null,
    },
  });

  return {
    outcome: 'blocked',
    applicantMessage: 'La teva sollicitud d accés ha estat rebutjada. Si creus que es un error, contacta amb el club.',
    adminMessage: 'Sollicitud rebutjada i usuari blocat.',
  };
}
