import { isAbsolute } from 'node:path';

import type { RuntimeConfig } from '../config/runtime-config.js';

export const defaultTelegramLocalBotApiBaseUrl = 'http://127.0.0.1:8081';
export const defaultTelegramLocalBotApiDataDir = '/var/lib/gameclubtelegrambot/telegram-bot-api';

export interface TelegramLocalBotApiServiceConfig {
  enabled: boolean;
  baseUrl: string;
  host: string;
  port: number;
  dataDir: string;
  tempDir: string;
}

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function resolveTelegramLocalBotApiServiceConfig(config: RuntimeConfig): TelegramLocalBotApiServiceConfig {
  const localBotApi = config.telegram.localBotApi;
  const baseUrl = localBotApi?.baseUrl ?? defaultTelegramLocalBotApiBaseUrl;
  const dataDir = localBotApi?.dataDir ?? defaultTelegramLocalBotApiDataDir;
  const url = new URL(baseUrl);

  if (url.protocol !== 'http:') {
    throw new Error('telegram.localBotApi.baseUrl must use http:// because the local Telegram Bot API server is local-only.');
  }

  if (localBotApi?.enabled === true && !loopbackHosts.has(url.hostname)) {
    throw new Error('telegram.localBotApi.baseUrl must point to localhost or another loopback address.');
  }

  if (localBotApi?.enabled === true && (url.pathname !== '/' || url.search !== '' || url.hash !== '')) {
    throw new Error('telegram.localBotApi.baseUrl must not include a path, query string, or fragment.');
  }

  if (localBotApi?.enabled === true && !isAbsolute(dataDir)) {
    throw new Error('telegram.localBotApi.dataDir must be an absolute path.');
  }

  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = url.port.length > 0 ? Number.parseInt(url.port, 10) : 80;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('telegram.localBotApi.baseUrl must include a valid TCP port.');
  }

  return {
    enabled: localBotApi?.enabled === true,
    baseUrl,
    host,
    port,
    dataDir,
    tempDir: `${dataDir.replace(/\/+$/, '')}/tmp`,
  };
}

export function formatTelegramLocalBotApiRuntimeConfig(config: RuntimeConfig): string {
  const serviceConfig = resolveTelegramLocalBotApiServiceConfig(config);

  return [
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_ENABLED=${shellQuote(String(serviceConfig.enabled))}`,
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_BASE_URL=${shellQuote(serviceConfig.baseUrl)}`,
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_HOST=${shellQuote(serviceConfig.host)}`,
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_PORT=${shellQuote(String(serviceConfig.port))}`,
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_DATA_DIR=${shellQuote(serviceConfig.dataDir)}`,
    `GAMECLUB_TELEGRAM_LOCAL_BOT_API_TEMP_DIR=${shellQuote(serviceConfig.tempDir)}`,
  ].join('\n').concat('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
