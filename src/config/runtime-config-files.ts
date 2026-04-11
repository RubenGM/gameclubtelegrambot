import { dirname, join } from 'node:path';

import { botLanguageValues, defaultRuntimeConfigPath } from './runtime-config.js';
import type { RuntimeConfig } from './runtime-config.js';

export type RuntimeConfigFieldType = 'string' | 'secret' | 'number' | 'boolean' | 'enum' | 'json';

export interface RuntimeConfigFieldSpec {
  path: string[];
  label: string;
  type: RuntimeConfigFieldType;
  destination: 'json' | 'env';
  section: string;
  description: string;
  envKey?: string;
  optional?: boolean;
  secret?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  example?: string;
}

export interface RuntimeConfigPaths {
  configPath: string;
  envPath: string;
}

const envAssignmentPattern = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export const runtimeConfigSections = [
  'Bot',
  'Telegram',
  'BoardGameGeek',
  'Database',
  'Admin Elevation',
  'Bootstrap',
  'Notifications',
  'Feature Flags',
] as const;

export const runtimeConfigFieldSpecs: RuntimeConfigFieldSpec[] = [
  {
    section: 'Bot',
    path: ['schemaVersion'],
    label: 'Schema version',
    type: 'number',
    destination: 'json',
    description: 'Runtime config schema version. Keep this at 1 for the current app version.',
    min: 1,
    max: 1,
  },
  {
    section: 'Bot',
    path: ['bot', 'publicName'],
    label: 'Public name',
    type: 'string',
    destination: 'json',
    description: 'Name shown publicly by the bot in user-facing messages.',
    example: 'Game Club Bot',
  },
  {
    section: 'Bot',
    path: ['bot', 'clubName'],
    label: 'Club name',
    type: 'string',
    destination: 'json',
    description: 'Human club name used in menus and notifications.',
    example: 'Game Club',
  },
  {
    section: 'Bot',
    path: ['bot', 'language'],
    label: 'Language',
    type: 'enum',
    destination: 'json',
    description: 'Default bot language for built-in copy and prompts.',
    options: botLanguageValues,
  },
  {
    section: 'Bot',
    path: ['bot', 'iconPath'],
    label: 'Icon path',
    type: 'string',
    destination: 'json',
    description: 'Optional path to the icon used by local tooling such as the Debian tray.',
    optional: true,
    example: '/opt/gameclub/assets/icon.png',
  },
  {
    section: 'Telegram',
    path: ['telegram', 'token'],
    label: 'Telegram token',
    type: 'secret',
    destination: 'env',
    envKey: 'GAMECLUB_TELEGRAM_TOKEN',
    secret: true,
    description: 'Telegram bot token. Stored in .env and never persisted back to runtime.json.',
  },
  {
    section: 'BoardGameGeek',
    path: ['bgg', 'apiKey'],
    label: 'BGG API key',
    type: 'secret',
    destination: 'env',
    envKey: 'GAMECLUB_BGG_API_KEY',
    optional: true,
    secret: true,
    description: 'Optional BoardGameGeek API key used as the primary metadata source for board games.',
  },
  {
    section: 'Database',
    path: ['database', 'host'],
    label: 'Host',
    type: 'string',
    destination: 'json',
    description: 'PostgreSQL host name or IP.',
    example: '127.0.0.1',
  },
  {
    section: 'Database',
    path: ['database', 'port'],
    label: 'Port',
    type: 'number',
    destination: 'json',
    description: 'PostgreSQL TCP port.',
    min: 1,
    max: 65535,
  },
  {
    section: 'Database',
    path: ['database', 'name'],
    label: 'Database name',
    type: 'string',
    destination: 'json',
    description: 'PostgreSQL database name for the bot.',
    example: 'gameclub',
  },
  {
    section: 'Database',
    path: ['database', 'user'],
    label: 'Database user',
    type: 'string',
    destination: 'json',
    description: 'PostgreSQL login user.',
    example: 'gameclub_user',
  },
  {
    section: 'Database',
    path: ['database', 'password'],
    label: 'Database password',
    type: 'secret',
    destination: 'env',
    envKey: 'GAMECLUB_DATABASE_PASSWORD',
    secret: true,
    description: 'PostgreSQL login password. Stored in .env only.',
  },
  {
    section: 'Database',
    path: ['database', 'ssl'],
    label: 'Use SSL',
    type: 'boolean',
    destination: 'json',
    description: 'Enable SSL/TLS for the PostgreSQL connection.',
  },
  {
    section: 'Admin Elevation',
    path: ['adminElevation', 'passwordHash'],
    label: 'Admin password hash',
    type: 'secret',
    destination: 'env',
    envKey: 'GAMECLUB_ADMIN_PASSWORD_HASH',
    secret: true,
    description: 'Password hash used for privileged admin elevation flows.',
  },
  {
    section: 'Bootstrap',
    path: ['bootstrap', 'firstAdmin', 'telegramUserId'],
    label: 'First admin Telegram ID',
    type: 'number',
    destination: 'json',
    description: 'Telegram user ID that receives initial administrator access.',
    min: 1,
  },
  {
    section: 'Bootstrap',
    path: ['bootstrap', 'firstAdmin', 'username'],
    label: 'First admin username',
    type: 'string',
    destination: 'json',
    description: 'Optional Telegram username of the first admin.',
    optional: true,
    example: 'club_admin',
  },
  {
    section: 'Bootstrap',
    path: ['bootstrap', 'firstAdmin', 'displayName'],
    label: 'First admin display name',
    type: 'string',
    destination: 'json',
    description: 'Display name used for bootstrap and admin-facing copy.',
    example: 'Club Administrator',
  },
  {
    section: 'Notifications',
    path: ['notifications', 'defaults', 'groupAnnouncementsEnabled'],
    label: 'Group announcements enabled',
    type: 'boolean',
    destination: 'json',
    description: 'Default opt-in state for group announcement broadcasts.',
  },
  {
    section: 'Notifications',
    path: ['notifications', 'defaults', 'eventRemindersEnabled'],
    label: 'Event reminders enabled',
    type: 'boolean',
    destination: 'json',
    description: 'Default opt-in state for activity reminder broadcasts.',
  },
  {
    section: 'Notifications',
    path: ['notifications', 'defaults', 'eventReminderLeadHours'],
    label: 'Reminder lead hours',
    type: 'number',
    destination: 'json',
    description: 'How many hours before an activity reminder messages should be sent.',
    min: 1,
    max: 168,
  },
  {
    section: 'Feature Flags',
    path: ['featureFlags'],
    label: 'Feature flags',
    type: 'json',
    destination: 'json',
    description: 'Map of feature flag names to boolean values.',
    optional: true,
    example: '{"bootstrapWizard": true}',
  },
];

export function resolveRuntimeConfigPaths(env: Record<string, string | undefined> = process.env): RuntimeConfigPaths {
  const configPath = env.GAMECLUB_CONFIG_PATH ?? defaultRuntimeConfigPath;
  const envPath = env.GAMECLUB_ENV_PATH ?? join(dirname(configPath), '.env');

  return {
    configPath,
    envPath,
  };
}

export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const match = trimmed.match(envAssignmentPattern);
    if (!match || !match[1]) {
      continue;
    }

    env[match[1]] = parseEnvValue(match[2] ?? '');
  }

  return env;
}

export function serializeEnvFile(existingText: string | undefined, values: Record<string, string>): string {
  const lines = (existingText ?? '').split(/\r?\n/);
  const entries = new Map(Object.entries(values));
  const output: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(envAssignmentPattern);
    if (!match || !match[1]) {
      output.push(line);
      continue;
    }

    const key = match[1];
    if (!entries.has(key)) {
      output.push(line);
      continue;
    }

    output.push(`${key}=${serializeEnvValue(entries.get(key) ?? '')}`);
    entries.delete(key);
  }

  if (output.length > 0 && output[output.length - 1] !== '') {
    output.push('');
  }

  for (const [key, value] of entries.entries()) {
    output.push(`${key}=${serializeEnvValue(value)}`);
  }

  return output.join('\n').replace(/\n+$/, '\n');
}

export function getNestedValue(source: unknown, path: string[]): unknown {
  let current: unknown = source;

  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) {
    return;
  }

  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!segment) {
      continue;
    }

    const next = current[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  const leaf = path[path.length - 1];
  if (!leaf) {
    return;
  }

  current[leaf] = value;
}

export function removeNestedValue(target: Record<string, unknown>, path: string[]): void {
  if (path.length === 0) {
    return;
  }

  const leaf = path[path.length - 1];
  if (!leaf) {
    return;
  }

  const parentPath = path.slice(0, -1);
  const parent = parentPath.length === 0 ? target : getMutableNestedObject(target, parentPath);
  if (!parent || !Object.prototype.hasOwnProperty.call(parent, leaf)) {
    return;
  }

  delete parent[leaf];
  pruneEmptyAncestors(target, parentPath);
}

export function normalizeObjectForJson(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function jsonTextFromValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  return JSON.stringify(value, null, 2);
}

export function parseJsonValue(text: string): unknown {
  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text);
}

export function splitRuntimeConfigForPersistence(
  config: RuntimeConfig,
  originalJson?: Record<string, unknown>,
): {
  jsonConfig: Record<string, unknown>;
  envValues: Record<string, string>;
} {
  const jsonConfig = deepClone(normalizeObjectForJson(originalJson));
  const envValues: Record<string, string> = {};

  for (const spec of runtimeConfigFieldSpecs) {
    const value = getNestedValue(config, spec.path);

    if (spec.destination === 'env' && spec.envKey) {
      if (value !== undefined && value !== null && value !== '') {
        envValues[spec.envKey] = String(value);
      }

      removeNestedValue(jsonConfig, spec.path);
      continue;
    }

    if (value === undefined || value === null || (value === '' && spec.optional)) {
      removeNestedValue(jsonConfig, spec.path);
      continue;
    }

    setNestedValue(jsonConfig, spec.path, deepClone(value));
  }

  return {
    jsonConfig,
    envValues,
  };
}

export function mergeRuntimeConfigSources(
  parsedConfig: unknown,
  envFileValues: Record<string, string>,
  processEnv: Record<string, string | undefined>,
): unknown {
  const merged = toMutableRecord(deepClone(parsedConfig));

  for (const fieldSpec of runtimeConfigFieldSpecs) {
    if (fieldSpec.destination !== 'env' || !fieldSpec.envKey) {
      continue;
    }

    const envValue = processEnv[fieldSpec.envKey] ?? envFileValues[fieldSpec.envKey];
    if (envValue !== undefined) {
      setNestedValue(merged, fieldSpec.path, envValue);
      continue;
    }

    const legacyValue = getNestedValue(merged, fieldSpec.path);
    if (legacyValue !== undefined && legacyValue !== null && legacyValue !== '') {
      setNestedValue(merged, fieldSpec.path, String(legacyValue));
    }
  }

  return merged;
}

export function fieldPathKey(path: string[]): string {
  return path.join('.');
}

export function getSectionFields(section: string): RuntimeConfigFieldSpec[] {
  return runtimeConfigFieldSpecs.filter((field) => field.section === section);
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function toMutableRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function getMutableNestedObject(target: Record<string, unknown>, path: string[]): Record<string, unknown> | undefined {
  let current: Record<string, unknown> | undefined = target;

  for (const segment of path) {
    const next = current?.[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      return undefined;
    }

    current = next as Record<string, unknown>;
  }

  return current;
}

function pruneEmptyAncestors(target: Record<string, unknown>, path: string[]): void {
  for (let index = path.length; index > 0; index -= 1) {
    const currentPath = path.slice(0, index);
    const leaf = currentPath[currentPath.length - 1];
    if (!leaf) {
      continue;
    }

    const parentPath = currentPath.slice(0, -1);
    const parent = parentPath.length === 0 ? target : getMutableNestedObject(target, parentPath);
    const current = parent?.[leaf];

    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      continue;
    }

    if (Object.keys(current).length > 0) {
      return;
    }

    if (parent) {
      delete parent[leaf];
    }
  }
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return '';
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'");
  }

  return stripInlineComment(trimmed);
}

function serializeEnvValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/"/g, '\\"');

  return `"${escaped}"`;
}

function stripInlineComment(value: string): string {
  const hashIndex = value.indexOf(' #');
  if (hashIndex === -1) {
    return value;
  }

  return value.slice(0, hashIndex).trimEnd();
}
