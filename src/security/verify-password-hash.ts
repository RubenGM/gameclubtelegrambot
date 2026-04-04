import { timingSafeEqual, scryptSync } from 'node:crypto';

export async function verifySecret(value: string, encodedHash: string): Promise<boolean> {
  const [algorithm, nString, rString, pString, saltHex, derivedKeyHex] = encodedHash.split(':');

  if (
    algorithm !== 'scrypt' ||
    !nString ||
    !rString ||
    !pString ||
    !saltHex ||
    !derivedKeyHex
  ) {
    return false;
  }

  const expected = Buffer.from(derivedKeyHex, 'hex');
  const derived = scryptSync(value, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(nString),
    r: Number(rString),
    p: Number(pString),
  });

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}
