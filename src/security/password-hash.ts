import { randomBytes, scryptSync } from 'node:crypto';

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = scryptSync(value, salt, KEY_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });

  return [
    'scrypt',
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join(':');
}
