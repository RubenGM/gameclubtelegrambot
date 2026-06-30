import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadTelegramFileViaLocalBotApi } from './telegram-local-file-download.js';

test('downloadTelegramFileViaLocalBotApi copies absolute local file paths returned by getFile', async () => {
  const fetchCalls: string[] = [];
  const mkdirCalls: string[] = [];
  const copyCalls: Array<{ source: string; destination: string }> = [];

  await downloadTelegramFileViaLocalBotApi({
    token: 'telegram-token',
    baseUrl: 'http://127.0.0.1:8081',
    fileId: 'large-file-id',
    destinationPath: '/tmp/gameclub-print/large-file-id',
    fetch: async (url) => {
      fetchCalls.push(String(url));
      return jsonResponse({
        ok: true,
        result: {
          file_path: '/var/lib/telegram-bot-api/telegram-token/documents/file.pdf',
        },
      });
    },
    mkdir: async (path) => {
      mkdirCalls.push(path);
    },
    copyFile: async (source, destination) => {
      copyCalls.push({ source, destination });
    },
    writeFile: async () => {
      throw new Error('writeFile should not be used for absolute local paths');
    },
  });

  assert.deepEqual(fetchCalls, ['http://127.0.0.1:8081/bottelegram-token/getFile?file_id=large-file-id']);
  assert.deepEqual(mkdirCalls, ['/tmp/gameclub-print']);
  assert.deepEqual(copyCalls, [{
    source: '/var/lib/telegram-bot-api/telegram-token/documents/file.pdf',
    destination: '/tmp/gameclub-print/large-file-id',
  }]);
});

test('downloadTelegramFileViaLocalBotApi downloads relative file paths through the local file endpoint', async () => {
  const fetchCalls: string[] = [];
  const writes: Array<{ path: string; bytes: Buffer }> = [];

  await downloadTelegramFileViaLocalBotApi({
    token: 'telegram-token',
    baseUrl: 'http://127.0.0.1:8081/',
    fileId: 'small-file-id',
    destinationPath: '/tmp/gameclub-print/small-file-id',
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (fetchCalls.length === 1) {
        return jsonResponse({
          ok: true,
          result: {
            file_path: 'documents/file.pdf',
          },
        });
      }
      return binaryResponse(Buffer.from('pdf bytes'));
    },
    mkdir: async () => {},
    copyFile: async () => {
      throw new Error('copyFile should not be used for relative paths');
    },
    writeFile: async (path, bytes) => {
      writes.push({ path, bytes: Buffer.from(bytes) });
    },
  });

  assert.deepEqual(fetchCalls, [
    'http://127.0.0.1:8081/bottelegram-token/getFile?file_id=small-file-id',
    'http://127.0.0.1:8081/file/bottelegram-token/documents/file.pdf',
  ]);
  assert.deepEqual(writes, [{
    path: '/tmp/gameclub-print/small-file-id',
    bytes: Buffer.from('pdf bytes'),
  }]);
});

test('downloadTelegramFileViaLocalBotApi reports getFile failures without leaking the token', async () => {
  await assert.rejects(
    () => downloadTelegramFileViaLocalBotApi({
      token: 'telegram-secret-token',
      baseUrl: 'http://127.0.0.1:8081',
      fileId: 'large-file-id',
      destinationPath: '/tmp/gameclub-print/large-file-id',
      fetch: async () => jsonResponse({ ok: false, description: 'Bad Request: file is missing' }),
      mkdir: async () => {},
      copyFile: async () => {},
      writeFile: async () => {},
    }),
    (error) => error instanceof Error
      && error.message.includes('Local Telegram Bot API getFile failed')
      && !error.message.includes('telegram-secret-token'),
  );
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function binaryResponse(bytes: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}
