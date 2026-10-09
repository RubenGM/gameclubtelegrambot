import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { loginClientAddress } from './login-client-address.js';

function request(remoteAddress: string, headers: IncomingMessage['headers'] = {}) {
  return { socket: { remoteAddress } as IncomingMessage['socket'], headers };
}

test('direct and untrusted clients cannot select their rate limit key using headers', () => {
  for (const proxies of [[], ['127.0.0.1']]) {
    assert.equal(loginClientAddress(request('198.51.100.1', {
      'x-real-ip': '203.0.113.2', 'x-forwarded-for': '203.0.113.3',
    }), proxies), '198.51.100.1');
  }
  assert.equal(loginClientAddress(request('127.0.0.1', { 'x-real-ip': '203.0.113.2' }), []), '127.0.0.1');
});

test('trusted proxy uses only its overwritten single valid X-Real-IP', () => {
  const proxies = ['127.0.0.1'];
  assert.equal(loginClientAddress(request('::ffff:127.0.0.1', {
    'x-real-ip': '203.0.113.2', 'x-forwarded-for': '192.0.2.7, 192.0.2.8',
  }), proxies), '203.0.113.2');
  for (const value of [undefined, '', 'invalid', '203.0.113.2, 203.0.113.3', ['203.0.113.2', '203.0.113.3'], '203.0.113.2:1234', 'fe80::1%eth0']) {
    const headers = value === undefined ? { 'x-forwarded-for': '203.0.113.2' } : { 'x-real-ip': value };
    assert.equal(loginClientAddress(request('127.0.0.1', headers), proxies), '127.0.0.1');
  }
});

test('equivalent IPv6 and IPv4-mapped addresses share the same limit', () => {
  assert.equal(loginClientAddress(request('::1', { 'x-real-ip': '2001:0db8:0:0:0:0:0:1' }), ['0:0:0:0:0:0:0:1']), '2001:db8::1');
  assert.equal(loginClientAddress(request('127.0.0.1', { 'x-real-ip': '::ffff:203.0.113.2' }), ['::ffff:7f00:1']), '203.0.113.2');
});
