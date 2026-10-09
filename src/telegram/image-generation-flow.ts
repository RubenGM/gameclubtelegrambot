import type { ImageGenerationService } from '../image-generation/codex-image-generation-service.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';

export const imageGenerationFlowKey = 'image-generation';
type ImageGenerationContext = TelegramCommandHandlerContext & { imageGenerationService?: ImageGenerationService };

/** Compatibility handler for old keyboards and sessions; generation is retired. */
export async function handleTelegramImageGenerationText(context: ImageGenerationContext): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (context.runtime.session.current?.flowKey !== imageGenerationFlowKey &&
    !/^\/image(?:gen)?(?:@\w+)?$/i.test(text) && text !== createTelegramI18n(language).actionMenu.imageGeneration) return false;
  return retireTelegramImageGeneration(context);
}

export async function handleTelegramImageGenerationMessage(context: ImageGenerationContext): Promise<boolean> {
  if (context.runtime.session.current?.flowKey !== imageGenerationFlowKey) return false;
  return retireTelegramImageGeneration(context);
}

export async function retireTelegramImageGeneration(context: TelegramCommandHandlerContext): Promise<boolean> {
  if (context.runtime.chat.kind !== 'private') return false;
  const flow = context.runtime.session.current?.flowKey;
  if (flow === imageGenerationFlowKey || flow === 'image-generation-permission') await context.runtime.session.cancel();
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  await context.reply(i18n.imageGeneration.deprecated, { replyKeyboard: [[i18n.actionMenu.start]], resizeKeyboard: true, persistentKeyboard: true });
  return true;
}
