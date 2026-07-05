import { copyFile as defaultCopyFile, mkdir as defaultMkdir, writeFile as defaultWriteFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

export interface LocalTelegramFileDownloadOptions {
  token: string;
  baseUrl: string;
  fileId: string;
  destinationPath: string;
  fetch?: typeof fetch;
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  copyFile?: (source: string, destination: string) => Promise<unknown>;
  writeFile?: (path: string, data: Buffer) => Promise<unknown>;
}

type TelegramGetFileResponse = {
  ok: boolean;
  description?: string;
  result?: {
    file_path?: string;
  };
};

export async function downloadTelegramFileViaLocalBotApi({
  token,
  baseUrl,
  fileId,
  destinationPath,
  fetch: fetchImpl = fetch,
  mkdir = defaultMkdir,
  copyFile = defaultCopyFile,
  writeFile = defaultWriteFile,
}: LocalTelegramFileDownloadOptions): Promise<void> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const file = await getTelegramFile({
    baseUrl: normalizedBaseUrl,
    token,
    fileId,
    fetch: fetchImpl,
  });

  const filePath = file.result?.file_path;
  if (!filePath) {
    throw new Error('Local Telegram Bot API getFile did not return file_path');
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  if (isAbsolute(filePath)) {
    await copyFile(filePath, destinationPath);
    return;
  }

  const downloadResponse = await fetchImpl(`${normalizedBaseUrl}/file/bot${token}/${encodeTelegramFilePath(filePath)}`);
  if (!downloadResponse.ok) {
    throw new Error(`Local Telegram Bot API file download failed with status ${downloadResponse.status}`);
  }

  await writeFile(destinationPath, Buffer.from(await downloadResponse.arrayBuffer()));
}

async function getTelegramFile({
  baseUrl,
  token,
  fileId,
  fetch: fetchImpl,
}: {
  baseUrl: string;
  token: string;
  fileId: string;
  fetch: typeof fetch;
}): Promise<TelegramGetFileResponse> {
  const response = await fetchImpl(`${baseUrl}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    throw new Error(`Local Telegram Bot API getFile failed with status ${response.status}`);
  }

  const payload = await response.json() as TelegramGetFileResponse;
  if (!payload.ok) {
    throw new Error(`Local Telegram Bot API getFile failed: ${sanitizeTelegramDescription(payload.description)}`);
  }
  return payload;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function encodeTelegramFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function sanitizeTelegramDescription(description: string | undefined): string {
  return description?.replace(/bot\d*:[A-Za-z0-9_-]+/g, 'bot<redacted>') ?? 'unknown error';
}
