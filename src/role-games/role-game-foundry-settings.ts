import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export const foundryConnectionMessageKey = 'foundry.connection_message';
export const foundryConnectionMessageMaxLength = 3500;

export interface FoundryConnectionMessage {
  text: string;
  html: string | null;
}

export interface FoundrySettingsStore {
  get(): Promise<FoundryConnectionMessage | null>;
  set(message: FoundryConnectionMessage): Promise<void>;
}

export function createAppMetadataFoundrySettingsStore({ storage }: {
  storage: AppMetadataSessionStorage;
}): FoundrySettingsStore {
  return {
    async get() {
      const raw = await storage.get(foundryConnectionMessageKey);
      if (raw === null) return null;
      return parseMessage(JSON.parse(raw));
    },
    async set(message) {
      await storage.set(foundryConnectionMessageKey, JSON.stringify(parseMessage(message)));
    },
  };
}

function parseMessage(value: unknown): FoundryConnectionMessage {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid Foundry connection message');
  const message = value as Partial<FoundryConnectionMessage>;
  if (typeof message.text !== 'string' || !message.text.trim()
    || message.text.length > foundryConnectionMessageMaxLength
    || (message.html !== null && typeof message.html !== 'string')) {
    throw new TypeError('Invalid Foundry connection message');
  }
  return { text: message.text, html: message.html };
}
