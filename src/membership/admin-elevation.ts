import { verifySecret } from '../security/verify-password-hash.js';

export interface AdminElevationUserRecord {
  telegramUserId: number;
  status: 'pending' | 'approved' | 'blocked';
  isAdmin: boolean;
}

export interface AdminElevationRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<AdminElevationUserRecord | null>;
  countApprovedAdmins?(): Promise<number>;
  elevateUserToAdmin(input: {
    telegramUserId: number;
    changedByTelegramUserId: number;
    reason?: string;
    actionKey?: string;
  }): Promise<AdminElevationUserRecord>;
  revokeUserAdminRole?(input: {
    telegramUserId: number;
    changedByTelegramUserId: number;
    reason?: string;
  }): Promise<AdminElevationUserRecord>;
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
    return {
      outcome: 'missing',
      message: 'No hem trobat cap usuari registrat per aquest compte.',
    };
  }

  if (user.status === 'blocked') {
    return {
      outcome: 'blocked',
      message: 'Aquest compte esta blocat i no pot elevar privilegis.',
    };
  }

  if (user.status !== 'approved') {
    return {
      outcome: 'not-approved',
      message: 'Nomes els usuaris aprovats poden demanar elevacio a administrador.',
    };
  }

  if (user.isAdmin) {
    return {
      outcome: 'already-admin',
      message: 'Ja tens permisos d administrador actius.',
    };
  }

  const valid = await verifySecretValue(password, passwordHash);
  if (!valid) {
    return {
      outcome: 'invalid-password',
      message: 'Contrasenya d elevacio incorrecta.',
    };
  }

  await repository.elevateUserToAdmin({
    telegramUserId,
    changedByTelegramUserId: telegramUserId,
  });

  return {
    outcome: 'elevated',
    message: 'Ara tens permisos d administrador. Escriu /start per refrescar les opcions visibles.',
  };
}

export async function grantAdminRoleToUser({
  repository,
  targetTelegramUserId,
  adminTelegramUserId,
  reason = 'admin-user-management',
}: {
  repository: AdminElevationRepository;
  targetTelegramUserId: number;
  adminTelegramUserId: number;
  reason?: string;
}): Promise<{ outcome: 'granted' | 'missing' | 'not-approved' | 'blocked' | 'already-admin'; message: string }> {
  const user = await repository.findUserByTelegramUserId(targetTelegramUserId);
  if (!user) return { outcome: 'missing', message: 'No hem trobat cap usuari registrat per aquest compte.' };
  if (user.status === 'blocked') return { outcome: 'blocked', message: 'Aquest compte esta blocat i no pot rebre rol admin.' };
  if (user.status !== 'approved') return { outcome: 'not-approved', message: 'Nomes els usuaris aprovats poden ser administradors.' };
  if (user.isAdmin) return { outcome: 'already-admin', message: 'Aquest usuari ja es administrador.' };

  await repository.elevateUserToAdmin({
    telegramUserId: targetTelegramUserId,
    changedByTelegramUserId: adminTelegramUserId,
    reason,
    actionKey: 'membership.admin-granted',
  });
  return { outcome: 'granted', message: 'Usuari ascendit a administrador correctament.' };
}

export async function revokeAdminRoleFromUser({
  repository,
  targetTelegramUserId,
  adminTelegramUserId,
  reason = 'admin-user-management',
}: {
  repository: AdminElevationRepository;
  targetTelegramUserId: number;
  adminTelegramUserId: number;
  reason?: string;
}): Promise<{ outcome: 'revoked' | 'missing' | 'not-approved' | 'not-admin' | 'last-admin'; message: string }> {
  const user = await repository.findUserByTelegramUserId(targetTelegramUserId);
  if (!user) return { outcome: 'missing', message: 'No hem trobat cap usuari registrat per aquest compte.' };
  if (user.status !== 'approved') return { outcome: 'not-approved', message: 'Aquest usuari no te acces aprovat.' };
  if (!user.isAdmin) return { outcome: 'not-admin', message: 'Aquest usuari no es administrador.' };

  const approvedAdminCount = repository.countApprovedAdmins ? await repository.countApprovedAdmins() : 2;
  if (approvedAdminCount <= 1) {
    return { outcome: 'last-admin', message: 'No es pot treure l ultim administrador del bot.' };
  }

  if (!repository.revokeUserAdminRole) {
    throw new Error('Admin role revocation is not supported by this repository');
  }

  await repository.revokeUserAdminRole({
    telegramUserId: targetTelegramUserId,
    changedByTelegramUserId: adminTelegramUserId,
    reason,
  });
  return { outcome: 'revoked', message: 'Acces d administrador eliminat correctament. L usuari conserva l acces de soci.' };
}
