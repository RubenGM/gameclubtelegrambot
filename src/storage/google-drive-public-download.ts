import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const googleDriveDownloadTimeoutMs = 30 * 60 * 1_000;
const googleDriveMaxRedirects = 6;

export type GoogleDrivePublicDownloadErrorCode =
  | 'invalid_url'
  | 'not_public'
  | 'not_downloadable'
  | 'too_large'
  | 'download_failed';

export class GoogleDrivePublicDownloadError extends Error {
  constructor(
    readonly code: GoogleDrivePublicDownloadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GoogleDrivePublicDownloadError';
  }
}

export type DownloadedGoogleDriveFile = {
  filePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  cleanup(): Promise<void>;
};

export type GoogleDrivePublicFileDownloader = (
  publicUrl: string,
  options: { maxBytes: number },
) => Promise<DownloadedGoogleDriveFile>;

export async function downloadGoogleDrivePublicFile(
  publicUrl: string,
  options: {
    maxBytes: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<DownloadedGoogleDriveFile> {
  const fileId = parseGoogleDriveFileId(publicUrl);
  if (!fileId) {
    throw new GoogleDrivePublicDownloadError('invalid_url', 'Unsupported Google Drive public file URL');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(googleDriveDownloadTimeoutMs);
  const response = await fetchGoogleDriveDownload(fetchImpl, buildGoogleDriveDownloadUrl(fileId), signal);
  if (!response.ok || !response.body) {
    throw new GoogleDrivePublicDownloadError(
      response.status === 401 || response.status === 403 || response.status === 404 ? 'not_public' : 'download_failed',
      `Google Drive download failed with status ${response.status}`,
    );
  }

  const contentType = normalizeContentType(response.headers.get('content-type'));
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    throw new GoogleDrivePublicDownloadError('not_public', 'Google Drive returned an access or preview page instead of a file');
  }
  if (contentType?.startsWith('application/vnd.google-apps.')) {
    throw new GoogleDrivePublicDownloadError('not_downloadable', 'Native Google Workspace documents need to be exported before upload');
  }

  const declaredSize = parseContentLength(response.headers.get('content-length'));
  if (declaredSize !== null && declaredSize > options.maxBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new GoogleDrivePublicDownloadError('too_large', 'Google Drive file exceeds the Storage upload limit');
  }

  const fileName = resolveDownloadFileName(response.headers.get('content-disposition'), fileId, contentType);
  const directoryPath = await mkdtemp(join(tmpdir(), 'gameclub-drive-'));
  const filePath = join(directoryPath, fileName);
  let receivedBytes = 0;
  const sizeGuard = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > options.maxBytes) {
        callback(new GoogleDrivePublicDownloadError('too_large', 'Google Drive file exceeds the Storage upload limit'));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      sizeGuard,
      createWriteStream(filePath, { flags: 'wx' }),
    );
    const fileStat = await stat(filePath);
    if (fileStat.size === 0) {
      throw new GoogleDrivePublicDownloadError('download_failed', 'Google Drive returned an empty file');
    }
    return {
      filePath,
      fileName,
      mimeType: contentType,
      sizeBytes: fileStat.size,
      cleanup: () => rm(directoryPath, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    if (error instanceof GoogleDrivePublicDownloadError) {
      throw error;
    }
    throw new GoogleDrivePublicDownloadError('download_failed', 'Google Drive file download failed', { cause: error });
  }
}

export function parseGoogleDriveFileId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  let candidate: string | null = null;
  if (hostname === 'drive.google.com') {
    const pathMatch = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/);
    candidate = pathMatch?.[1] ?? url.searchParams.get('id');
  } else if (hostname === 'drive.usercontent.google.com') {
    candidate = url.searchParams.get('id');
  }
  return candidate && /^[A-Za-z0-9_-]{10,}$/.test(candidate) ? candidate : null;
}

function buildGoogleDriveDownloadUrl(fileId: string): URL {
  const url = new URL('https://drive.usercontent.google.com/download');
  url.searchParams.set('id', fileId);
  url.searchParams.set('export', 'download');
  url.searchParams.set('confirm', 't');
  return url;
}

async function fetchGoogleDriveDownload(
  fetchImpl: typeof fetch,
  initialUrl: URL,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= googleDriveMaxRedirects; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'gameclubtelegrambot-storage/1.0' },
      });
    } catch (error) {
      throw new GoogleDrivePublicDownloadError('download_failed', 'Could not connect to Google Drive', { cause: error });
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get('location');
    if (!location || redirectCount === googleDriveMaxRedirects) {
      throw new GoogleDrivePublicDownloadError('download_failed', 'Google Drive returned too many redirects');
    }
    const redirectUrl = new URL(location, currentUrl);
    if (isGoogleAuthenticationHost(redirectUrl.hostname)) {
      throw new GoogleDrivePublicDownloadError('not_public', 'Google Drive requires authentication for this file');
    }
    if (redirectUrl.protocol !== 'https:' || !isAllowedGoogleDriveDownloadHost(redirectUrl.hostname)) {
      throw new GoogleDrivePublicDownloadError('download_failed', 'Google Drive redirected to an unsupported host');
    }
    currentUrl = redirectUrl;
  }
  throw new GoogleDrivePublicDownloadError('download_failed', 'Google Drive returned too many redirects');
}

function isGoogleAuthenticationHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'accounts.google.com' || normalized.endsWith('.accounts.google.com');
}

function isAllowedGoogleDriveDownloadHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'drive.google.com'
    || normalized === 'drive.usercontent.google.com'
    || normalized.endsWith('.googleusercontent.com');
}

function normalizeContentType(value: string | null): string | null {
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

function parseContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveDownloadFileName(contentDisposition: string | null, fileId: string, contentType: string | null): string {
  const encodedMatch = contentDisposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plainMatch = contentDisposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let candidate = encodedMatch?.[1]
    ? safeDecodeURIComponent(encodedMatch[1])
    : plainMatch?.[1] ?? plainMatch?.[2]?.trim() ?? '';
  candidate = basename(candidate.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 180);
  if (candidate && candidate !== '.' && candidate !== '..') {
    return candidate;
  }
  return `google-drive-${fileId}${extensionForContentType(contentType)}`;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extensionForContentType(contentType: string | null): string {
  switch (contentType) {
    case 'application/pdf': return '.pdf';
    case 'application/zip': return '.zip';
    case 'image/jpeg': return '.jpg';
    case 'image/png': return '.png';
    case 'video/mp4': return '.mp4';
    case 'audio/mpeg': return '.mp3';
    default: return '';
  }
}
