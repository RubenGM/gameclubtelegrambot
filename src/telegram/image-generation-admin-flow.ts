import { createDatabaseImageGenerationPermissionRepository, type ImageGenerationPermissionRepository, type ImageGenerationPermissionUserRecord } from '../image-generation/image-generation-permissions.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { buildTelegramStartUrl } from './deep-links.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

const flowKey = 'image-generation-permission';
const grantPrefix = 'imagegen_grant_';
const revokePrefix = 'imagegen_revoke_';
type Step = 'grant' | 'revoke' | 'list';
type Context = TelegramCommandHandlerContext & { imageGenerationPermissionRepository?: ImageGenerationPermissionRepository };

export async function handleTelegramImageGenerationAdminStartText(context: Context): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) return false;
  const match = /^\/start\s+(imagegen_(?:grant|revoke)_\d+)$/i.exec(text);
  if (!match) return false;
  const payload = match[1];
  if (!payload) return false;
  const userId = Number(payload.slice(payload.lastIndexOf('_') + 1));
  const grant = payload.startsWith(grantPrefix);
  return change(context, userId, grant ? 'grant' : 'revoke');
}

export async function handleTelegramImageGenerationAdminText(context: Context): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isAdmin) return false;
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).imageGeneration;
  if (context.runtime.session.current?.flowKey === flowKey) {
    if (text === texts.cancelButton || /^\/cancel$/i.test(text)) { await context.runtime.session.cancel(); await context.reply(texts.cancelled, adminKeyboard(texts)); return true; }
    if (/^\d+$/.test(text)) return change(context, Number(text), context.runtime.session.current.stepKey === 'grant' ? 'grant' : 'revoke');
    await context.reply('Escriu l’ID d’un usuari de la llista o toca Cancel·lar.');
    return true;
  }
  if (text === 'Conceder imágenes') return handleTelegramImageGenerationAdminAction(context, 'grant');
  if (text === 'Revocar imágenes') return handleTelegramImageGenerationAdminAction(context, 'revoke');
  if (text === 'Accesos imágenes') return handleTelegramImageGenerationAdminAction(context, 'list');
  if (text !== '/imagegen_admin' && text !== createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).actionMenu.imageGenerationAdmin) return false;
  await context.reply('Administració de generació d’imatges: tria una acció.', adminKeyboard(texts));
  return true;
}

export async function handleTelegramImageGenerationAdminAction(context: Context, action: 'grant' | 'revoke' | 'list'): Promise<boolean> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).imageGeneration;
  const users = action === 'grant' ? await repository(context).listGrantableUsers() : await repository(context).listAllowedUsers();
  if (users.length === 0) { await context.reply(action === 'grant' ? 'No hay socios aprobados disponibles.' : 'No hay socios con permiso explícito.', adminKeyboard(texts)); return true; }
  if (action === 'list') { await context.reply(renderUsers(context, users, 'list'), adminKeyboard(texts),); return true; }
  await context.runtime.session.start({ flowKey, stepKey: action, data: {} });
  await context.reply(renderUsers(context, users, action), { parseMode: 'HTML', ...adminKeyboard(texts) });
  return true;
}

function renderUsers(context: Context, users: ImageGenerationPermissionUserRecord[], action: Step): string {
  const header = action === 'grant' ? 'Socis als quals pots concedir generació d’imatges:' : action === 'revoke' ? 'Socis als quals pots revocar generació d’imatges:' : 'Socis amb permís de generació d’imatges:';
  return [header, '', ...users.map((user) => {
    const label = escapeHtml(`${user.displayName}${user.username ? ` (@${user.username})` : ''} · ${user.telegramUserId}`);
    if (action === 'list') return `<a href="tg://user?id=${user.telegramUserId}">${label}</a>`;
    const payload = `${action === 'grant' ? grantPrefix : revokePrefix}${user.telegramUserId}`;
    return `<a href="${buildTelegramStartUrl(payload)}">${label}</a>`;
  }), '', action === 'list' ? '' : 'También puedes escribir el ID del socio.'].join('\n');
}

async function change(context: Context, userId: number, action: 'grant' | 'revoke'): Promise<boolean> {
  const texts = createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).imageGeneration;
  const user = await repository(context).findUserByTelegramUserId(userId);
  if (!user || user.status !== 'approved' || user.isAdmin) { await context.reply('Elige un socio aprobado de la lista.', adminKeyboard(texts)); return true; }
  if (action === 'grant') await repository(context).grantPermission({ subjectTelegramUserId: userId, changedByTelegramUserId: context.runtime.actor.telegramUserId });
  else await repository(context).revokePermission({ subjectTelegramUserId: userId, changedByTelegramUserId: context.runtime.actor.telegramUserId });
  await context.runtime.session.cancel();
  await context.reply(`Permiso de generación de imágenes ${action === 'grant' ? 'concedido a' : 'revocado a'} ${user.displayName}.`, adminKeyboard(texts));
  return true;
}

function repository(context: Context): ImageGenerationPermissionRepository { return context.imageGenerationPermissionRepository ?? createDatabaseImageGenerationPermissionRepository({ database: context.runtime.services.database.db }); }
function adminKeyboard(texts: ReturnType<typeof createTelegramI18n>['imageGeneration']): TelegramReplyOptions { return { replyKeyboard: [['Conceder imágenes', 'Revocar imágenes'], ['Accesos imágenes'], [texts.cancelButton]], resizeKeyboard: true, persistentKeyboard: true }; }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
