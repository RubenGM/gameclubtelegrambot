import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';

import { handleTelegramImageGenerationMessage, handleTelegramImageGenerationText } from './image-generation-flow.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import type { ConversationSessionRecord } from './conversation-session.js';

test('direct image generation is admin-accessible, accepts a reference and sends the generated image', async () => {
  const fixture = createContext();
  assert.equal(await handleTelegramImageGenerationText({ ...fixture.context, messageText: '/imagegen' }), true);
  assert.equal(fixture.current()?.stepKey, 'mode');
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Describir' });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Una torre junto al mar al atardecer' });
  await handleTelegramImageGenerationMessage({ ...fixture.context, messageMedia: { attachmentKind: 'photo', fileId: 'reference', originalFileName: 'reference.jpg', mimeType: 'image/jpeg', messageId: 8 } });
  assert.equal(fixture.current()?.data.referenceImagePaths instanceof Array, true);
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Generar imagen' });
  assert.deepEqual(fixture.generated, [{ prompt: 'Una torre junto al mar al atardecer', references: 1 }]);
  assert.equal(fixture.media.length, 1);
  assert.equal(fixture.current(), null);
});

test('guided image generation refines the prompt before generating', async () => {
  const fixture = createContext();
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: '/imagegen' });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Guiado' });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Una escena de rol acogedora' });
  assert.match(String(fixture.current()?.data.prompt), /PROMPT: Una escena/);
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'que llueva fuera' });
  assert.match(String(fixture.current()?.data.prompt), /que llueva fuera/);
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: 'Generar imagen' });
  assert.equal(fixture.generated[0]?.prompt.includes('que llueva fuera'), true);
});

test('approved members need the separate image permission', async () => {
  const fixture = createContext({ isAdmin: false, allowed: false });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: '/imagegen' });
  assert.match(fixture.replies.at(-1)?.message ?? '', /No tienes permiso/);
  assert.equal(fixture.current(), null);
});

test('approved members with the separate permission can start generation', async () => {
  const fixture = createContext({ isAdmin: false, allowed: true });
  await handleTelegramImageGenerationText({ ...fixture.context, messageText: '/imagegen' });
  assert.equal(fixture.current()?.stepKey, 'mode');
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
