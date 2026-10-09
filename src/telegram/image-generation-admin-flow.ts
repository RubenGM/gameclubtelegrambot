import type { ImageGenerationPermissionRepository } from '../image-generation/image-generation-permissions.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { retireTelegramImageGeneration } from './image-generation-flow.js';

type Context = TelegramCommandHandlerContext & { imageGenerationPermissionRepository?: ImageGenerationPermissionRepository };

export async function handleTelegramImageGenerationAdminStartText(context: Context): Promise<boolean> {
  if (!/^\/start\s+imagegen_(?:grant|revoke)_\d+$/i.test(context.messageText?.trim() ?? '')) return false;
  return retireTelegramImageGeneration(context);
}

export async function handleTelegramImageGenerationAdminText(context: Context): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (context.runtime.session.current?.flowKey !== 'image-generation-permission' &&
    !/^\/imagegen_admin(?:@\w+)?$/i.test(text) &&
    text !== createTelegramI18n(language).actionMenu.imageGenerationAdmin &&
    !['Conceder imágenes', 'Revocar imágenes', 'Accesos imágenes'].includes(text)) return false;
  return retireTelegramImageGeneration(context);
}

export async function handleTelegramImageGenerationAdminAction(context: Context, _action: 'grant' | 'revoke' | 'list'): Promise<boolean> {
  return retireTelegramImageGeneration(context);
}
