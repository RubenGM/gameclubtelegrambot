import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppMetadataFoundrySettingsStore, foundryConnectionMessageKey } from '../role-games/role-game-foundry-settings.js';
import type { TelegramCommandHandler, TelegramCommandHandlerContext } from './command-registry.js';
import { createAppMetadataConversationSessionStore, type AppMetadataSessionStorage } from './conversation-session-store.js';
import { loadConversationSessionRuntime } from './conversation-session.js';
import { createTelegramI18n, supportedBotLanguages } from './i18n.js';
import {
  foundryAdminCallbackPrefix,
  foundryAdminFlowKey,
  handleTelegramFoundryAdminCallback,
  handleTelegramFoundryAdminText,
  handleTelegramFoundryCommand,
  openTelegramFoundryAdmin,
} from './role-game-foundry-flow.js';
import { registerHandlers } from './runtime-boundary-registration.js';
import type { TelegramBotLike, TelegramReplyOptions } from './runtime-boundary.js';

test('/foundry is registered for members in private chats and groups', async () => {
  const commands = new Map<string, TelegramCommandHandler>();
  const callbacks = new Map<string, TelegramCommandHandler>();
  registerHandlers({
    bot: {
      onCommand: (name: string, handler: TelegramCommandHandler) => { commands.set(name, handler); },
      onCallback: (prefix: string, handler: TelegramCommandHandler) => { callbacks.set(prefix, handler); },
      onText: () => {},
    } as unknown as TelegramBotLike,
    publicName: 'Club', adminElevationPasswordHash: '',
  });
  assert.ok(commands.has('foundry'));
  assert.ok(callbacks.has(foundryAdminCallbackPrefix));
  for (const kind of ['private', 'group', 'group-news'] as const) {
    const fixture = await createFixture();
    fixture.context.runtime.chat.kind = kind;
    await commands.get('foundry')!(fixture.context);
    assert.match(fixture.replies.at(-1)!.message, /https:\/\/cawa.hopto.org\/foundry\//);
  }
  const pending = await createFixture();
  pending.context.runtime.actor.isApproved = false;
  await commands.get('foundry')!(pending.context);
  assert.equal(pending.replies.at(-1)!.message, createTelegramI18n('es').common.accessDeniedApproved);
});

test('default connection instructions follow the member language and preserve their active flow', async () => {
  const fixture = await createFixture();
  await fixture.context.runtime.session.start({ flowKey: 'role-game', stepKey: 'title' });
  for (const language of supportedBotLanguages) {
    fixture.context.runtime.bot.language = language;
    await handleTelegramFoundryCommand(fixture.context);
    assert.match(fixture.replies.at(-1)!.message, /Foundry VTT/);
    assert.match(fixture.replies.at(-1)!.message, /https:\/\/cawa.hopto.org\/foundry\//);
  }
  assert.equal(fixture.context.runtime.session.current?.flowKey, 'role-game');
});

test('admin edits persist formatting across store recreation and are used by the next command', async () => {
  const fixture = await createFixture();
  await openTelegramFoundryAdmin(fixture.context);
  assert.match(fixture.replies.at(-1)!.message, /mensaje de conexión/);
  fixture.context.callbackData = `${foundryAdminCallbackPrefix}edit`;
  await handleTelegramFoundryAdminCallback(fixture.context);
  assert.equal(fixture.context.runtime.session.current?.flowKey, foundryAdminFlowKey);
  fixture.context.messageText = '  Entrar & jugar';
  fixture.context.messageEntities = [{ type: 'bold', offset: 2, length: 6 }];
  assert.equal(await handleTelegramFoundryAdminText(fixture.context), true);
  assert.equal(fixture.context.runtime.session.current, null);
  assert.ok(fixture.records.has(foundryConnectionMessageKey));
  fixture.context.foundrySettingsStore = createAppMetadataFoundrySettingsStore({ storage: fixture.storage });
  await handleTelegramFoundryCommand(fixture.context);
  assert.equal(fixture.replies.at(-1)!.message, '  <b>Entrar</b> &amp; jugar');
  assert.equal(fixture.replies.at(-1)!.options?.parseMode, 'HTML');

  fixture.context.callbackData = `${foundryAdminCallbackPrefix}preview`;
  await handleTelegramFoundryAdminCallback(fixture.context);
  assert.equal(fixture.replies.at(-1)!.message, '  <b>Entrar</b> &amp; jugar');
});

test('invalid input and cancellation preserve the previous message', async () => {
  const fixture = await createFixture();
  await fixture.context.foundrySettingsStore.set({ text: 'Mensaje anterior <literal>', html: null });
  fixture.context.callbackData = `${foundryAdminCallbackPrefix}edit`;
  await handleTelegramFoundryAdminCallback(fixture.context);
  for (const invalid of ['', '   ', 'a'.repeat(3501)]) {
    fixture.context.messageText = invalid;
    await handleTelegramFoundryAdminText(fixture.context);
    assert.equal(fixture.context.runtime.session.current?.flowKey, foundryAdminFlowKey);
    assert.equal((await fixture.context.foundrySettingsStore.get())?.text, 'Mensaje anterior <literal>');
  }
  fixture.context.callbackData = `${foundryAdminCallbackPrefix}cancel`;
  await handleTelegramFoundryAdminCallback(fixture.context);
  assert.equal(fixture.context.runtime.session.current, null);
  await handleTelegramFoundryCommand(fixture.context);
  assert.equal(fixture.replies.at(-1)!.message, 'Mensaje anterior &lt;literal&gt;');
});

test('admin access is rechecked on callbacks and save, including blocked users and groups', async () => {
  for (const forbidden of ['member', 'blocked', 'group'] as const) {
    const fixture = await createFixture();
    fixture.context.callbackData = `${foundryAdminCallbackPrefix}edit`;
    await handleTelegramFoundryAdminCallback(fixture.context);
    if (forbidden === 'member') fixture.context.runtime.actor.isAdmin = false;
    if (forbidden === 'blocked') fixture.context.runtime.actor.isBlocked = true;
    if (forbidden === 'group') fixture.context.runtime.chat.kind = 'group';
    fixture.context.messageText = 'No debe guardarse';
    await handleTelegramFoundryAdminText(fixture.context);
    assert.equal(await fixture.context.foundrySettingsStore.get(), null);
    fixture.context.callbackData = `${foundryAdminCallbackPrefix}edit`;
    await handleTelegramFoundryAdminCallback(fixture.context);
    assert.equal(fixture.replies.at(-1)!.message, createTelegramI18n('es').common.accessDeniedAdmin);
  }
});

test('stale admin buttons do not replace a different active flow', async () => {
  const fixture = await createFixture();
  await fixture.context.runtime.session.start({ flowKey: 'storage-upload', stepKey: 'file' });
  fixture.context.callbackData = `${foundryAdminCallbackPrefix}edit`;
  await handleTelegramFoundryAdminCallback(fixture.context);
  assert.equal(fixture.context.runtime.session.current?.flowKey, 'storage-upload');
  assert.equal(await handleTelegramFoundryAdminText(fixture.context), false);
});

async function createFixture() {
  const records = new Map<string, string>();
  const storage: AppMetadataSessionStorage = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => { records.set(key, value); },
    delete: async (key) => records.delete(key),
    listByPrefix: async (prefix) => Array.from(records, ([key, value]) => ({ key, value })).filter((row) => row.key.startsWith(prefix)),
  };
  const session = await loadConversationSessionRuntime({
    scope: { chatId: 1, userId: 42 },
    store: createAppMetadataConversationSessionStore({ storage }),
  });
  const replies: Array<{ message: string; options?: TelegramReplyOptions }> = [];
  const context = {
    messageText: '',
    foundrySettingsStore: createAppMetadataFoundrySettingsStore({ storage }),
    reply: async (message: string, options?: TelegramReplyOptions) => { replies.push({ message, ...(options ? { options } : {}) }); },
    runtime: {
      bot: { publicName: 'Bot', clubName: 'Club', language: 'es', sendPrivateMessage: async () => {} },
      services: {} as never,
      chat: { kind: 'private', chatId: 1 },
      actor: { telegramUserId: 42, status: 'approved', isApproved: true, isBlocked: false, isAdmin: true, permissions: [] },
      authorization: {} as never,
      session,
    },
  } as TelegramCommandHandlerContext & { foundrySettingsStore: ReturnType<typeof createAppMetadataFoundrySettingsStore> };
  return { context, records, storage, replies };
}
