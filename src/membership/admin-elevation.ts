import { verifySecret } from '../security/verify-password-hash.js';

export interface AdminElevationUserRecord {
  telegramUserId: number;
  status: 'pending' | 'approved' | 'blocked';
  isAdmin: boolean;
}

export interface AdminElevationRepository {
  findUserByTelegramUserId(telegramUserId: number): Promise<AdminElevationUserRecord | null>;
  elevateUserToAdmin(input: {
    telegramUserId: number;
    changedByTelegramUserId: number;
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
