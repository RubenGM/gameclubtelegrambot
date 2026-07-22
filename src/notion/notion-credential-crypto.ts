import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptNotionCredential(value: string, encryptionKey: string): string {
  const key = parseKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptNotionCredential(value: string, encryptionKey: string): string {
  const [ivText, tagText, ciphertextText, extra] = value.split('.');
  if (!ivText || !tagText || !ciphertextText || extra) throw new Error('La credencial de Notion guardada no tiene un formato válido.');
  const decipher = createDecipheriv('aes-256-gcm', parseKey(encryptionKey), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error('La clave de cifrado de Notion debe tener exactamente 32 bytes (hex o base64).');
  return key;
}
