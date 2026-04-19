export interface ConversationSessionRecord {
  key: string;
  flowKey: string;
  stepKey: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ConversationSessionStore {
  loadSession(key: string): Promise<ConversationSessionRecord | null>;
  saveSession(session: ConversationSessionRecord): Promise<void>;
  deleteSession(key: string): Promise<boolean>;
  deleteExpiredSessions(nowIso: string): Promise<number>;
}

export interface ConversationSessionScope {
  chatId: number;
  userId: number;
}

export interface ConversationSessionRuntime {
  current: ConversationSessionRecord | null;
  start(input: {
    flowKey: string;
    stepKey: string;
    data?: Record<string, unknown>;
  }): Promise<ConversationSessionRecord>;
  advance(input: {
    stepKey: string;
    data: Record<string, unknown>;
  }): Promise<ConversationSessionRecord>;
  cancel(): Promise<boolean>;
}

export interface LoadConversationSessionRuntimeOptions {
  scope: ConversationSessionScope;
  store: ConversationSessionStore;
  now?: () => Date;
  ttlMs?: number;
}

const defaultSessionTtlMs = 1000 * 60 * 60 * 24;

export async function loadConversationSessionRuntime({
  scope,
  store,
  now = () => new Date(),
  ttlMs = defaultSessionTtlMs,
}: LoadConversationSessionRuntimeOptions): Promise<ConversationSessionRuntime> {
  const sessionKey = createConversationSessionKey(scope);
  const nowIso = now().toISOString();

  let current = await store.loadSession(sessionKey);

  if (current && current.expiresAt <= nowIso) {
    await store.deleteSession(sessionKey);
    current = null;
  }

  return {
    get current() {
      return current;
    },
    async start({ flowKey, stepKey, data = {} }) {
      const startedAt = now().toISOString();
      const session: ConversationSessionRecord = {
        key: sessionKey,
        flowKey,
        stepKey,
        data,
        createdAt: startedAt,
        updatedAt: startedAt,
        expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
      };

      await store.saveSession(session);
      current = session;
      return session;
    },
    async advance({ stepKey, data }) {
      if (!current) {
        throw new Error('No active conversation session to advance');
      }

      const advanced: ConversationSessionRecord = {
        ...current,
        stepKey,
        data,
        updatedAt: now().toISOString(),
        expiresAt: new Date(now().getTime() + ttlMs).toISOString(),
      };

      await store.saveSession(advanced);
      current = advanced;
      return advanced;
    },
    async cancel() {
      const deleted = await store.deleteSession(sessionKey);
      current = null;
      return deleted;
    },
  };
}

export function createConversationSessionKey({
  chatId,
  userId,
}: ConversationSessionScope): string {
  return `telegram.session:${chatId}:${userId}`;
}
