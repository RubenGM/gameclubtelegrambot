import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';
import { createTelegramI18n, type BotLanguage } from './i18n.js';

export class TelegramInteractionError extends Error {
  cancelSession: boolean;

  constructor(message: string, options: { cancelSession?: boolean } = {}) {
    super(message);
    this.name = 'TelegramInteractionError';
    this.cancelSession = options.cancelSession ?? false;
  }
}

export type TelegramCommandAccess = 'public' | 'approved' | 'admin';
export type TelegramHelpSection = 'schedule' | 'catalog' | 'group_purchases' | 'storage';

export interface TelegramCommandRuntime {
  bot: {
    publicName: string;
    clubName: string;
    language?: BotLanguage;
    username?: string | undefined;
    getMe?(): Promise<{ id: number; username?: string }>;
    getChat?(chatId: number): Promise<{ id: number; type: string; title?: string; isForum?: boolean }>;
    getChatMember?(chatId: number, userId: number): Promise<{ status: string; canManageTopics?: boolean }>;
    createForumTopic?(input: { chatId: number; name: string }): Promise<{ chatId: number; name: string; messageThreadId: number }>;
    sendPrivateMessage(telegramUserId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    sendGroupMessage?(chatId: number, message: string, options?: TelegramReplyOptions): Promise<void>;
    copyMessage?(input: { fromChatId: number; messageId: number; toChatId: number; messageThreadId?: number }): Promise<{ messageId: number }>;
    deleteMessage?(input: { chatId: number; messageId: number }): Promise<void>;
  };
  services: InfrastructureRuntimeServices;
  chat: TelegramChatContext;
  actor: TelegramActor;
  authorization: AuthorizationService;
  session: ConversationSessionRuntime;
}

export interface TelegramCommandHandlerContext {
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  messageText?: string;
  callbackData?: string;
  messageThreadId?: number;
  messageMedia?: {
    attachmentKind: string;
    fileId?: string | null;
    fileUniqueId?: string | null;
    caption?: string | null;
    originalFileName?: string | null;
    mimeType?: string | null;
    fileSizeBytes?: number | null;
    mediaGroupId?: string | null;
    messageId: number;
  };
  sharedChat?: {
    requestId: number;
    chatId: number;
    title?: string | null;
  };
  reply(message: string, options?: TelegramReplyOptions): Promise<unknown>;
  runtime: TelegramCommandRuntime;
  __replies?: string[];
}

export type TelegramCommandHandler = (
  context: TelegramCommandHandlerContext,
) => Promise<unknown> | unknown;

export interface TelegramCommandDefinition {
  command: string;
  contexts: TelegramChatContextKind[];
  access?: TelegramCommandAccess;
  description?: string;
  descriptionByLanguage?: Partial<Record<BotLanguage, string>>;
  handle: TelegramCommandHandler;
}

export interface TelegramCommandRegistrar {
  onCommand(command: string, handler: TelegramCommandHandler): void;
}

export function registerTelegramCommands({
  bot,
  commands,
}: {
  bot: TelegramCommandRegistrar;
  commands: TelegramCommandDefinition[];
}): void {
  for (const command of commands) {
    bot.onCommand(command.command, async (context) => {
      const language = context.runtime.bot.language ?? 'ca';
      if (!command.contexts.includes(context.runtime.chat.kind)) {
        await context.reply(restrictionMessageFor(command.contexts, language));
        return;
      }

      const access = command.access ?? 'public';
      if (!hasRequiredAccess(context, access)) {
        await context.reply(accessDeniedMessageFor(access, language));
        return;
      }

      try {
        await command.handle(context);
      } catch (error) {
        if (error instanceof TelegramInteractionError) {
          if (error.cancelSession) {
            await context.runtime.session.cancel();
          }

          await context.reply(error.message);
          return;
        }

        throw error;
      }
    });
  }
}

export function renderTelegramHelpMessage({
  commands,
  context,
  section,
}: {
  commands: TelegramCommandDefinition[];
  context: TelegramCommandHandlerContext;
  section?: TelegramHelpSection | undefined;
}): string {
  void commands;
  const language = context.runtime.bot.language ?? 'ca';
  const i18n = createTelegramI18n(language);
  const lines: string[] = [i18n.common.helpHeader];

  if (context.runtime.chat.kind !== 'private') {
    lines.push(i18n.common.helpFooterPrivate);
    lines.push('');
    lines.push(`${i18n.actionMenu.language}: ${i18n.common.helpLanguageAction}`);
    return lines.join('\n');
  }

  if (!context.runtime.actor.isApproved) {
    lines.push(`${i18n.actionMenu.access}: ${i18n.common.helpAccessAction}`);
    lines.push(`${i18n.actionMenu.language}: ${i18n.common.helpLanguageAction}`);
    lines.push('');
    lines.push(i18n.common.helpPendingApproval);
    return lines.join('\n');
  }

  const contextualHelp = section ? helpTextForSection(section, i18n.common) : undefined;
  if (contextualHelp) {
    lines.push(contextualHelp);
    lines.push('');
  }

  if (context.runtime.actor.isAdmin) {
    lines.push(`${i18n.actionMenu.reviewAccess}: ${i18n.common.helpReviewAccessAction}`);
    lines.push(`${i18n.actionMenu.manageUsers}: ${i18n.common.helpManageUsersAction}`);
    lines.push(`${i18n.actionMenu.schedule}: ${i18n.common.helpScheduleAction}`);
    lines.push(`${i18n.actionMenu.tables}: ${i18n.common.helpTablesAction}`);
    lines.push(`${i18n.actionMenu.catalog}: ${i18n.common.helpCatalogAction}`);
    lines.push(`${i18n.actionMenu.storage}: ${i18n.common.helpStorageAction}`);
    lines.push(`${i18n.actionMenu.groupPurchases}: ${i18n.common.helpGroupPurchasesAction}`);
    lines.push(`${i18n.actionMenu.language}: ${i18n.common.helpLanguageAction}`);
    lines.push('');
    lines.push(i18n.common.helpMenuHint);
    return lines.join('\n');
  }

  lines.push(`${i18n.actionMenu.schedule}: ${i18n.common.helpScheduleAction}`);
  lines.push(`${i18n.actionMenu.tablesRead}: ${i18n.common.helpTablesAction}`);
  lines.push(`${i18n.actionMenu.catalog}: ${i18n.common.helpCatalogAction}`);
  lines.push(`${i18n.actionMenu.storage}: ${i18n.common.helpStorageAction}`);
  lines.push(`${i18n.actionMenu.groupPurchases}: ${i18n.common.helpGroupPurchasesAction}`);
  lines.push(`${i18n.actionMenu.language}: ${i18n.common.helpLanguageAction}`);
  lines.push('');
  lines.push(i18n.common.helpMenuHint);

  return lines.join('\n');
}

function helpTextForSection(
  section: TelegramHelpSection,
  common: ReturnType<typeof createTelegramI18n>['common'],
): string {
  if (section === 'schedule') {
    return common.helpContextSchedule;
  }

  if (section === 'catalog') {
    return common.helpContextCatalog;
  }

  if (section === 'group_purchases') {
    return common.helpContextGroupPurchases;
  }

  return common.helpContextStorage;
}

function hasRequiredAccess(
  context: TelegramCommandHandlerContext,
  access: TelegramCommandAccess,
): boolean {
  if (access === 'public') {
    return true;
  }

  if (access === 'approved') {
    return context.runtime.actor.isApproved;
  }

  return context.runtime.actor.isAdmin;
}

function accessDeniedMessageFor(access: TelegramCommandAccess, language: BotLanguage): string {
  const i18n = createTelegramI18n(language);
  if (access === 'approved') {
    return i18n.common.accessDeniedApproved;
  }

  if (access === 'admin') {
    return i18n.common.accessDeniedAdmin;
  }

  return i18n.common.accessDeniedGeneric;
}

function restrictionMessageFor(contexts: TelegramChatContextKind[], language: BotLanguage): string {
  const i18n = createTelegramI18n(language);
  if (contexts.length === 1 && contexts[0] === 'private') {
    return i18n.common.privateOnly;
  }

  return i18n.common.contextRestricted;
}
