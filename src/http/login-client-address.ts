import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

function normalizeAddress(value: string): string | null {
  if (isIP(value) === 4) return value;
  if (isIP(value) !== 6 || value.includes('%')) return null;
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1]!, 16);
  const low = Number.parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Trust a single X-Real-IP only when the immediate peer is explicitly trusted.
 * The proxy must overwrite this header, as the deployed Nginx does.
 */
export function loginClientAddress(request: Pick<IncomingMessage, 'socket' | 'headers'>, trustedProxyAddresses: readonly string[]): string {
  const remote = request.socket.remoteAddress ?? 'unknown';
  const peer = normalizeAddress(remote) ?? remote;
  if (!trustedProxyAddresses.some((address) => normalizeAddress(address) === peer)) return peer;
  const forwarded = request.headers['x-real-ip'];
  if (typeof forwarded !== 'string') return peer;
  return normalizeAddress(forwarded.trim()) ?? peer;
}
