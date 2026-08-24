import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  downloadGoogleDrivePublicFile,
  GoogleDrivePublicDownloadError,
  parseGoogleDriveFileId,
} from './google-drive-public-download.js';

const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz';

test('parseGoogleDriveFileId accepts public Drive file links and rejects unrelated URLs', () => {
  assert.equal(parseGoogleDriveFileId(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`), fileId);
  assert.equal(parseGoogleDriveFileId(`https://drive.google.com/open?id=${fileId}`), fileId);
  assert.equal(parseGoogleDriveFileId(`https://drive.usercontent.google.com/download?id=${fileId}&export=download`), fileId);
  assert.equal(parseGoogleDriveFileId(`http://drive.google.com/file/d/${fileId}/view`), null);
  assert.equal(parseGoogleDriveFileId('https://example.com/manual.pdf'), null);
});

test('downloadGoogleDrivePublicFile streams the binary response and preserves its filename', async () => {
  const requestedUrls: string[] = [];
  const downloaded = await downloadGoogleDrivePublicFile(
    `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
    {
      maxBytes: 1024,
      fetchImpl: (async (input: URL | RequestInfo) => {
        requestedUrls.push(String(input));
        return new Response('pdf bytes', {
          headers: {
            'content-type': 'application/pdf',
            'content-length': '9',
            'content-disposition': "attachment; filename*=UTF-8''manual%20rol.pdf",
          },
        });
      }) as typeof fetch,
    },
  );

  try {
    assert.match(requestedUrls[0] ?? '', /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
    assert.equal(downloaded.fileName, 'manual rol.pdf');
    assert.equal(downloaded.mimeType, 'application/pdf');
    assert.equal(downloaded.sizeBytes, 9);
    assert.equal(await readFile(downloaded.filePath, 'utf8'), 'pdf bytes');
  } finally {
    await downloaded.cleanup();
  }
});

test('downloadGoogleDrivePublicFile rejects access pages and oversized files', async () => {
  await assert.rejects(
    downloadGoogleDrivePublicFile(`https://drive.google.com/file/d/${fileId}/view`, {
      maxBytes: 1024,
      fetchImpl: (async () => new Response('<html>request access</html>', {
        headers: { 'content-type': 'text/html' },
      })) as typeof fetch,
    }),
    (error: unknown) => error instanceof GoogleDrivePublicDownloadError && error.code === 'not_public',
  );

  await assert.rejects(
    downloadGoogleDrivePublicFile(`https://drive.google.com/file/d/${fileId}/view`, {
      maxBytes: 4,
      fetchImpl: (async () => new Response('too large', {
        headers: { 'content-type': 'application/pdf' },
      })) as typeof fetch,
    }),
    (error: unknown) => error instanceof GoogleDrivePublicDownloadError && error.code === 'too_large',
  );
});

test('downloadGoogleDrivePublicFile classifies a Google login redirect as a non-public file', async () => {
  await assert.rejects(
    downloadGoogleDrivePublicFile(`https://drive.google.com/file/d/${fileId}/view`, {
      maxBytes: 1024,
      fetchImpl: (async () => new Response(null, {
        status: 302,
        headers: { location: 'https://accounts.google.com/ServiceLogin?service=wise' },
      })) as typeof fetch,
    }),
    (error: unknown) => error instanceof GoogleDrivePublicDownloadError && error.code === 'not_public',
  );
});
