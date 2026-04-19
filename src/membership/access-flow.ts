import { normalizeDisplayName, resolveMembershipDisplayName } from './display-name.js';

export type MembershipUserStatus = 'pending' | 'approved' | 'blocked' | 'revoked';

export interface MembershipRevocationRecord {
  changedByTelegramUserId: number;
  createdAt: string;
  reason: string | null;
}

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
  listRevocableUsers(): Promise<MembershipUserRecord[]>;
  listApprovedAdminUsers(): Promise<MembershipUserRecord[]>;
  findLatestRevocation(telegramUserId: number): Promise<MembershipRevocationRecord | null>;
  appendStatusAuditLog(input: {
    telegramUserId: number;
    previousStatus: MembershipUserStatus | null;
    nextStatus: MembershipUserStatus;
    changedByTelegramUserId: number;
    reason?: string | null;
  }): Promise<void>;
  approveMembershipRequest(input: {
    telegramUserId: number;
    previousStatus: MembershipUserStatus;
    changedByTelegramUserId: number;
  }): Promise<MembershipUserRecord>;
  rejectMembershipRequest(input: {
    telegramUserId: number;
    previousStatus: MembershipUserStatus;
    changedByTelegramUserId: number;
    reason?: string | null;
  }): Promise<MembershipUserRecord>;
  revokeMembershipAccess(input: {
    telegramUserId: number;
    previousStatus: MembershipUserStatus;
    changedByTelegramUserId: number;
    reason: string;
  }): Promise<MembershipUserRecord>;
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
  const resolvedDisplayName = resolveMembershipDisplayName({
    displayName,
    ...(username !== undefined ? { username } : {}),
  });

  await repository.syncUserProfile({
    telegramUserId,
    ...(username !== undefined ? { username } : {}),
    displayName: resolvedDisplayName,
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
        'La teva sollicitud d acces ja esta pendent. Un administrador del club l ha de revisar abans que puguis fer servir activitats, calendari, cataleg i taules. Si vols agilitzar-ho, avisa un administrador i digues-li que ja t has registrat al bot.',
    };
  }

  await repository.upsertPendingUser({
    telegramUserId,
    ...(username !== undefined ? { username: normalizeDisplayName(username) } : {}),
    displayName: resolvedDisplayName,
  });
  await repository.appendStatusAuditLog({
    telegramUserId,
    previousStatus: existing?.status ?? null,
    nextStatus: 'pending',
    changedByTelegramUserId: telegramUserId,
    reason: 'member-access-request',
  });

  return {
    outcome: 'created',
    message:
      'He registrat la teva sollicitud d acces. Ara queda pendent de revisio per part d un administrador del club. Quan te l aprovin, ja podras fer servir activitats, calendari, cataleg i taules. Si vols agilitzar-ho, avisa un administrador i digues-li que ja t has registrat al bot.',
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

export async function listRevocableMembershipUsers({
  repository,
}: {
  repository: MembershipAccessRepository;
}): Promise<{ users: MembershipUserRecord[] }> {
  return {
    users: await repository.listRevocableUsers(),
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

  if (existing.status !== 'pending') {
    return {
      outcome: 'missing',
      applicantMessage: 'Aquest usuari ha de tornar a demanar accés amb /access abans de poder-se aprovar.',
      adminMessage: 'Aquest usuari no te cap sollicitud pendent activa. Primer ha de tornar a demanar /access.',
    };
  }

  await repository.approveMembershipRequest({
    telegramUserId: applicantTelegramUserId,
    previousStatus: existing.status,
    changedByTelegramUserId: adminTelegramUserId,
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

  await repository.rejectMembershipRequest({
    telegramUserId: applicantTelegramUserId,
    previousStatus: existing.status,
    changedByTelegramUserId: adminTelegramUserId,
    ...(reason !== undefined ? { reason } : {}),
  });

  return {
    outcome: 'blocked',
    applicantMessage: 'La teva sollicitud d accés ha estat rebutjada. Si creus que es un error, contacta amb el club.',
    adminMessage: 'Sollicitud rebutjada i usuari blocat.',
  };
}

export async function revokeMembershipAccess({
  repository,
  applicantTelegramUserId,
  adminTelegramUserId,
  reason,
}: {
  repository: MembershipAccessRepository;
  applicantTelegramUserId: number;
  adminTelegramUserId: number;
  reason: string;
}): Promise<{
  outcome: 'revoked' | 'missing' | 'not-approved' | 'admin-user';
  applicantMessage: string;
  adminMessage: string;
}> {
  const existing = await repository.findUserByTelegramUserId(applicantTelegramUserId);

  if (!existing) {
    return {
      outcome: 'missing',
      applicantMessage: 'No s ha trobat cap usuari amb aquest identificador.',
      adminMessage: 'No s ha trobat cap usuari amb aquest identificador.',
    };
  }

  if (existing.isAdmin) {
    return {
      outcome: 'admin-user',
      applicantMessage: 'Els administradors no es poden expulsar des d aquest flux.',
      adminMessage: 'Els administradors no es poden expulsar des d aquest flux.',
    };
  }

  if (existing.status !== 'approved') {
    return {
      outcome: 'not-approved',
      applicantMessage: 'Aquest usuari ja no te accés aprovat.',
      adminMessage: 'Aquest usuari ja no te accés aprovat.',
    };
  }

  await repository.revokeMembershipAccess({
    telegramUserId: applicantTelegramUserId,
    previousStatus: existing.status,
    changedByTelegramUserId: adminTelegramUserId,
    reason,
  });

  return {
    outcome: 'revoked',
    applicantMessage:
      'Un administrador t ha revocat l accés al bot. Si vols tornar a entrar, torna a demanar accés amb /access.',
    adminMessage: 'Accés revocat correctament. L usuari haura de tornar a demanar /access si vol reingressar.',
  };
}
