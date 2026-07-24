import { chmod, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { imageGenerationPermissionKey } from '../image-generation/image-generation-permissions.js';
import { createCodexImageGenerationService, type ImageGenerationService } from '../image-generation/codex-image-generation-service.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const imageGenerationFlowKey = 'image-generation';

type ImageGenerationContext = TelegramCommandHandlerContext & { imageGenerationService?: ImageGenerationService };
type ImageGenerationData = {
  mode: 'direct' | 'guided';
  workspace: string;
  description?: string;
  prompt?: string;
  changes?: string[];
  referenceImagePaths?: string[];
};

export async function handleTelegramImageGenerationText(context: ImageGenerationContext): Promise<boolean> {
  const text = context.messageText?.trim() ?? '';
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).imageGeneration;
  const session = context.runtime.session.current;
  if (session?.flowKey === imageGenerationFlowKey) return continueFlow(context, text);
  if (!text || (!/^\/image(?:gen)?(?:@\w+)?$/i.test(text) && text !== createTelegramI18n(language).actionMenu.imageGeneration)) return false;
  if (context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved || context.runtime.actor.isBlocked) return false;
  if (!canUseImageGeneration(context)) {
    await context.reply(texts.noPermission);
    return true;
  }
  const workspace = await resolveService(context).createWorkspace();
  await context.runtime.session.start({ flowKey: imageGenerationFlowKey, stepKey: 'mode', data: { workspace } });
  await context.reply(texts.chooseMode, keyboard([[texts.describeButton, texts.guidedButton], [texts.cancelButton]]));
  return true;
}

export async function handleTelegramImageGenerationMessage(context: ImageGenerationContext): Promise<boolean> {
  const session = context.runtime.session.current;
  if (session?.flowKey !== imageGenerationFlowKey || !['direct-input', 'guided-input', 'guided-review'].includes(session.stepKey)) return false;
  const media = context.messageMedia;
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).imageGeneration;
  if (!media?.fileId || !isImage(media)) {
    await context.reply(texts.unsupportedReference, activeKeyboard(texts));
    return true;
  }
  const data = session.data as ImageGenerationData;
  const references = data.referenceImagePaths ?? [];
  if (references.length >= 4) {
    await context.reply(texts.referenceLimit, activeKeyboard(texts));
    return true;
  }
  const destinationPath = join(data.workspace, `reference-${references.length + 1}-${safeName(media.originalFileName ?? media.fileId)}`);
  await mkdir(data.workspace, { recursive: true });
  if (!context.runtime.bot.downloadFile) throw new Error('Telegram runtime does not expose file download support');
  try {
    await context.runtime.bot.downloadFile({ fileId: media.fileId, destinationPath, allowLocalBotApi: true });
    await chmod(destinationPath, 0o644);
  } catch (error) {
    context.runtime.logger?.warn?.({ error: error instanceof Error ? error.message : String(error) }, 'image-generation.reference-download.failed');
    await context.reply(texts.referenceDownloadFailed, activeKeyboard(texts));
    return true;
  }
  await context.runtime.session.advance({ stepKey: session.stepKey, data: { ...data, referenceImagePaths: [...references, destinationPath] } });
  await context.reply(format(texts.referenceAdded, { count: String(references.length + 1) }), activeKeyboard(texts));
  return true;
}

async function continueFlow(context: ImageGenerationContext, text: string): Promise<boolean> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = createTelegramI18n(language).imageGeneration;
  const session = context.runtime.session.current;
  if (!session || session.flowKey !== imageGenerationFlowKey) return false;
  const data = session.data as ImageGenerationData;
  if (text === texts.cancelButton || /^\/cancel$/i.test(text)) return cancel(context, data, texts.cancelled);
  if (session.stepKey === 'mode') {
    if (text === texts.describeButton) {
      await context.runtime.session.advance({ stepKey: 'direct-input', data: { ...data, mode: 'direct', referenceImagePaths: [] } });
      await context.reply(texts.describePrompt, activeKeyboard(texts));
      return true;
    }
    if (text === texts.guidedButton) {
      await context.runtime.session.advance({ stepKey: 'guided-input', data: { ...data, mode: 'guided', changes: [], referenceImagePaths: [] } });
      await context.reply(texts.guidedPrompt, keyboard([[texts.cancelButton]]));
      return true;
    }
    await context.reply(texts.chooseMode, keyboard([[texts.describeButton, texts.guidedButton], [texts.cancelButton]]));
    return true;
  }
  if (session.stepKey === 'direct-input') {
    if (text === texts.generateButton) return generate(context, data, texts);
    if (!text) { await context.reply(texts.describePrompt, activeKeyboard(texts)); return true; }
    await context.runtime.session.advance({ stepKey: 'direct-input', data: { ...data, description: text } });
    await context.reply(texts.descriptionSaved, activeKeyboard(texts));
    return true;
  }
  if (session.stepKey === 'guided-input') {
    if (!text) { await context.reply(texts.guidedPrompt, keyboard([[texts.cancelButton]])); return true; }
    const progress = await startTelegramEditableProgress(context, texts.optimizing, { editFailedEvent: 'image-generation.prompt-progress-edit.failed' });
    try {
      const prompt = await resolveService(context).optimizePrompt({ workspace: data.workspace, description: text, changes: [] });
      await context.runtime.session.advance({ stepKey: 'guided-review', data: { ...data, description: text, prompt, changes: [] } });
      await progress.complete(format(texts.guidedProposal, { prompt }));
      await context.reply(texts.guidedReviewPrompt, activeKeyboard(texts));
    } catch (error) {
      context.runtime.logger?.error({ error: error instanceof Error ? error.message : String(error) }, 'image-generation.prompt-optimization.failed');
      await progress.complete(texts.optimizationFailed);
    }
    return true;
  }
  if (session.stepKey === 'guided-review') {
    if (text === texts.generateButton) return generate(context, data, texts);
    if (!text) { await context.reply(texts.guidedReviewPrompt, activeKeyboard(texts)); return true; }
    const changes = [...(data.changes ?? []), text];
    const progress = await startTelegramEditableProgress(context, texts.optimizing, { editFailedEvent: 'image-generation.prompt-progress-edit.failed' });
    try {
      const prompt = await resolveService(context).optimizePrompt({ workspace: data.workspace, description: data.description ?? '', changes });
      await context.runtime.session.advance({ stepKey: 'guided-review', data: { ...data, prompt, changes } });
      await progress.complete(format(texts.guidedProposal, { prompt }));
      await context.reply(texts.guidedReviewPrompt, activeKeyboard(texts));
    } catch (error) {
      context.runtime.logger?.error({ error: error instanceof Error ? error.message : String(error) }, 'image-generation.prompt-optimization.failed');
      await progress.complete(texts.optimizationFailed);
    }
    return true;
  }
  return false;
}

async function generate(context: ImageGenerationContext, data: ImageGenerationData, texts: ReturnType<typeof createTelegramI18n>['imageGeneration']): Promise<boolean> {
  const prompt = data.mode === 'guided' ? data.prompt : data.description;
  if (!prompt) { await context.reply(texts.descriptionRequired, activeKeyboard(texts)); return true; }
  const progress = await startTelegramEditableProgress(context, texts.generating, { editFailedEvent: 'image-generation.progress-edit.failed' });
  try {
    const imagePath = await resolveService(context).generate({ workspace: data.workspace, prompt, referenceImagePaths: data.referenceImagePaths ?? [] });
    if (!context.runtime.bot.sendMediaGroup) throw new Error('Telegram runtime does not expose photo upload support');
    await context.runtime.bot.sendMediaGroup({ chatId: context.runtime.chat.chatId, media: [{ type: 'photo', media: { filePath: imagePath }, caption: texts.generatedCaption }] });
    await context.runtime.session.cancel();
    await resolveService(context).cleanup(data.workspace);
    await progress.complete(texts.generated);
  } catch (error) {
    context.runtime.logger?.error({ error: error instanceof Error ? error.message : String(error) }, 'image-generation.failed');
    await progress.complete(texts.generationFailed);
  }
  return true;
}

async function cancel(context: ImageGenerationContext, data: ImageGenerationData, message: string): Promise<boolean> {
  await context.runtime.session.cancel();
  await resolveService(context).cleanup(data.workspace);
  await context.reply(message);
  return true;
}

function canUseImageGeneration(context: ImageGenerationContext): boolean {
  return context.runtime.actor.isAdmin || context.runtime.authorization.can(imageGenerationPermissionKey);
}
function resolveService(context: ImageGenerationContext): ImageGenerationService { return context.imageGenerationService ?? createCodexImageGenerationService(); }
function isImage(media: NonNullable<TelegramCommandHandlerContext['messageMedia']>): boolean { return media.attachmentKind === 'photo' || media.mimeType?.startsWith('image/') === true; }
function safeName(value: string): string { return basename(value).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100) || 'reference.png'; }
function activeKeyboard(texts: ReturnType<typeof createTelegramI18n>['imageGeneration']): TelegramReplyOptions { return keyboard([[texts.generateButton], [texts.cancelButton]]); }
function keyboard(replyKeyboard: string[][]): TelegramReplyOptions { return { replyKeyboard, resizeKeyboard: true, persistentKeyboard: true }; }
function format(template: string, replacements: Record<string, string>): string { return Object.entries(replacements).reduce((value, [key, replacement]) => value.replaceAll(`{${key}}`, replacement), template); }
