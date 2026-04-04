import { verifySecret } from '../security/verify-password-hash.js';
import { appendAuditEvent, type AuditLogAppendInput } from '../audit/audit-log.js';

export interface AdminElevationUserRecord {
  telegramUserId: number;
  status: 'pending' | 'approved' | 'blocked';
  isAdmin: boolean;
}

export interface AdminElevationRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<AdminElevationUserRecord | null>;
  updateAdminRole(input: {
    telegramUserId: number;
    isAdmin: boolean;
    changedByTelegramUserId: number;
  }): Promise<AdminElevationUserRecord>;
  appendAdminElevationAuditLog(input: {
    telegramUserId: number;
    outcome: 'elevated' | 'not-approved' | 'blocked' | 'already-admin' | 'invalid-password' | 'missing';
    reason?: string | null;
  }): Promise<void>;
  appendAuditEvent(input: AuditLogAppendInput): Promise<void>;
}

export async function elevateApprovedUserToAdmin({
  repository,
  telegramUserId,
  password,
  passwordHash,
  verifySecret: verifySecretValue = verifySecret,
}: {
  repository: AdminElevationRepository;
  telegramUserId: number;
  password: string;
  passwordHash: string;
  verifySecret?: (value: string, encodedHash: string) => Promise<boolean>;
}): Promise<{
  outcome: 'elevated' | 'not-approved' | 'blocked' | 'already-admin' | 'invalid-password' | 'missing';
  message: string;
}> {
  const user = await repository.findUserByTelegramUserId(telegramUserId);

  if (!user) {
    await repository.appendAdminElevationAuditLog({
      telegramUserId,
      outcome: 'missing',
      reason: 'user-not-found',
    });
    return {
      outcome: 'missing',
      message: 'No hem trobat cap usuari registrat per aquest compte.',
    };
  }

  if (user.status === 'blocked') {
    await repository.appendAdminElevationAuditLog({
      telegramUserId,
      outcome: 'blocked',
      reason: 'blocked-user',
    });
    return {
      outcome: 'blocked',
      message: 'Aquest compte esta blocat i no pot elevar privilegis.',
    };
  }

  if (user.status !== 'approved') {
    await repository.appendAdminElevationAuditLog({
      telegramUserId,
      outcome: 'not-approved',
      reason: 'not-approved',
    });
    return {
      outcome: 'not-approved',
      message: 'Nomes els usuaris aprovats poden demanar elevacio a administrador.',
    };
  }

  if (user.isAdmin) {
    await repository.appendAdminElevationAuditLog({
      telegramUserId,
      outcome: 'already-admin',
      reason: 'already-admin',
    });
    return {
      outcome: 'already-admin',
      message: 'Ja tens permisos d administrador actius.',
    };
  }

  const valid = await verifySecretValue(password, passwordHash);
  if (!valid) {
    await repository.appendAdminElevationAuditLog({
      telegramUserId,
      outcome: 'invalid-password',
      reason: 'invalid-password',
    });
    return {
      outcome: 'invalid-password',
      message: 'Contrasenya d elevacio incorrecta.',
    };
  }

  await repository.updateAdminRole({
    telegramUserId,
    isAdmin: true,
    changedByTelegramUserId: telegramUserId,
  });
  await repository.appendAdminElevationAuditLog({
    telegramUserId,
    outcome: 'elevated',
    reason: 'password-match',
  });
  await appendAuditEvent({
    repository: { appendEvent: repository.appendAuditEvent },
    actorTelegramUserId: telegramUserId,
    actionKey: 'membership.admin-elevated',
    targetType: 'membership-user',
    targetId: telegramUserId,
    summary: 'Usuari elevat a administrador',
    details: {
      outcome: 'elevated',
    },
  });

  return {
    outcome: 'elevated',
    message: 'Ara tens permisos d administrador. Escriu /start per refrescar les opcions visibles.',
  };
}
