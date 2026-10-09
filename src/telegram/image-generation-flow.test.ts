import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';

import { handleTelegramImageGenerationMessage, handleTelegramImageGenerationText } from './image-generation-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';

for (const actor of [{ isAdmin: true, allowed: true }, { isAdmin: false, allowed: true }, { isAdmin: false, allowed: false }]) {
  test(`deprecated generation cannot start for ${JSON.stringify(actor)}`, async () => {
    const fixture = createContext(actor);
    for (const text of ['/imagegen', '/image', '/imagegen@club_bot', 'Generación de imágenes']) {
      assert.equal(await handleTelegramImageGenerationText({ ...fixture.context, messageText: text }), true);
      assert.match(fixture.replies.at(-1)?.message ?? '', /deprecada/);
      assert.equal(fixture.current(), null);
    }
    assert.deepEqual(fixture.generated, []);
    assert.deepEqual(fixture.media, []);
  });
}

test('deprecated generation cancels a persisted session without generating or downloading references', async () => {
  const fixture = createContext();
  await fixture.context.runtime.session.start({ flowKey: 'image-generation', stepKey: 'direct-input', data: { workspace: '/tmp/old-workspace', description: 'Old prompt' } });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Generar imagen' });
  assert.equal(fixture.current(), null);
  assert.deepEqual(fixture.generated, []);
  await fixture.context.runtime.session.start({ flowKey: 'image-generation', stepKey: 'guided-review', data: {} });
  await handleTelegramImageGenerationMessage({ ...fixture.context, messageMedia: { attachmentKind: 'photo', fileId: 'reference', messageId: 8 } });
  assert.equal(fixture.current(), null);
  assert.deepEqual(fixture.media, []);
});

test('deprecated image handlers leave unrelated messages and sessions alone', async () => {
  const fixture = createContext();
  await fixture.context.runtime.session.start({ flowKey: 'schedule-create', stepKey: 'title', data: {} });
  assert.equal(await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Catan' }), false);
  assert.equal(await handleTelegramImageGenerationMessage(fixture.context), false);
  assert.equal(fixture.current()?.flowKey, 'schedule-create');
});

test('deprecated image permission commands, links and sessions cannot grant access', async () => {
  const { handleTelegramImageGenerationAdminText, handleTelegramImageGenerationAdminStartText, handleTelegramImageGenerationAdminAction } = await import('./image-generation-admin-flow.js');
  const fixture = createContext();
  for (const text of ['/imagegen_admin', 'Imágenes IA', 'Conceder imágenes', 'Revocar imágenes', 'Accesos imágenes']) {
    assert.equal(await handleTelegramImageGenerationAdminText({ ...fixture.context, messageText: text }), true);
    assert.match(fixture.replies.at(-1)?.message ?? '', /deprecada/);
  }
  assert.equal(await handleTelegramImageGenerationAdminStartText({ ...fixture.context, messageText: '/start imagegen_grant_42' }), true);
  assert.equal(await handleTelegramImageGenerationAdminAction(fixture.context, 'grant'), true);
  await fixture.context.runtime.session.start({ flowKey: 'image-generation-permission', stepKey: 'grant', data: {} });
  await handleTelegramImageGenerationAdminText({ ...fixture.context, messageText: '42' });
  assert.equal(fixture.current(), null);
});

function createContext({ isAdmin = true, allowed = false }: { isAdmin?: boolean; allowed?: boolean } = {}) {
  let session: ConversationSessionRecord | null = null;
  const replies: Array<{ message: string }> = [];
  const media: unknown[] = [];
  const generated: Array<{ prompt: string; references: number }> = [];
  const workspace = `/tmp/image-generation-test-${Math.random().toString(16).slice(2)}`;
  const context = {
    reply: async (message: string) => { replies.push({ message }); return { message_id: replies.length }; },
    runtime: {
      chat: { kind: 'private' as const, chatId: 7 },
      actor: { telegramUserId: 7, status: 'approved', isApproved: true, isBlocked: false, isAdmin, permissions: [] },
      authorization: { authorize: () => ({ allowed, permissionKey: 'image_generation.use', reason: allowed ? 'global-allow' as const : 'no-match' as const }), can: () => allowed },
      session: {
        get current() { return session; },
        async start({ flowKey, stepKey, data = {} }: { flowKey: string; stepKey: string; data?: Record<string, unknown> }) {
          session = { key: 'test', flowKey, stepKey, data, createdAt: '', updatedAt: '', expiresAt: '' }; return session;
        },
        async advance({ stepKey, data }: { stepKey: string; data: Record<string, unknown> }) {
          if (!session) throw new Error('missing session'); session = { ...session, stepKey, data }; return session;
        },
        async cancel() { session = null; return true; },
      },
      bot: {
        language: 'es' as const, publicName: 'Test', clubName: 'Test', sendPrivateMessage: async () => {},
        downloadFile: async ({ destinationPath }: { destinationPath: string }) => { await writeFile(destinationPath, 'image'); },
        sendMediaGroup: async (input: unknown) => { media.push(input); return [{ messageId: 1 }]; },
      },
      services: {} as TelegramCommandHandlerContext['runtime']['services'],
    },
    imageGenerationService: {
      createWorkspace: async () => workspace,
      cleanup: async () => {},
      optimizePrompt: async ({ description, changes }: { description: string; changes: string[] }) => `PROMPT: ${description}${changes.length ? `; ${changes.join('; ')}` : ''}`,
      generate: async ({ prompt, referenceImagePaths }: { prompt: string; referenceImagePaths: string[] }) => { generated.push({ prompt, references: referenceImagePaths.length }); return '/tmp/generated.png'; },
    },
  } satisfies TelegramCommandHandlerContext & Record<string, unknown>;
  return { context, replies, media, generated, current: () => session };
}
