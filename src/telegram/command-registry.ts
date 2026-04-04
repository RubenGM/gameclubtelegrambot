import type { AuthorizationService } from '../authorization/service.js';
import type { TelegramActor } from './actor-store.js';
import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';
import type { ConversationSessionRuntime } from './conversation-session.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export class TelegramInteractionError extends Error {
  cancelSession: boolean;

  constructor(message: string, options: { cancelSession?: boolean } = {}) {
    super(message);
    this.name = 'TelegramInteractionError';
    this.cancelSession = options.cancelSession ?? false;
  }
}

export type TelegramCommandAccess = 'public' | 'approved' | 'admin';

export interface TelegramCommandRuntime {
  bot: {
    publicName: string;
    clubName: string;
    language?: string;
    sendPrivateMessage(telegramUserId: number, message: string): Promise<void>;
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
  };
  messageText?: string;
  callbackData?: string;
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
      if (!command.contexts.includes(context.runtime.chat.kind)) {
        await context.reply(restrictionMessageFor(command.contexts));
        return;
      }

      const access = command.access ?? 'public';
      if (!hasRequiredAccess(context, access)) {
        await context.reply(accessDeniedMessageFor(access));
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
}: {
  commands: TelegramCommandDefinition[];
  context: TelegramCommandHandlerContext;
}): string {
  const visibleCommands = commands.filter((command) => {
    const access = command.access ?? 'public';
    return (
      command.description &&
      command.contexts.includes(context.runtime.chat.kind) &&
      hasRequiredAccess(context, access)
    );
  });

  const lines = ['Comandes disponibles en aquest xat:'];

  for (const command of visibleCommands) {
    lines.push(`/${command.command} - ${command.description}`);
  }

  if (context.runtime.chat.kind !== 'private') {
    lines.push('');
    lines.push('Per veure totes les funcions, escriu-me en privat.');
  }

  return lines.join('\n');
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

function accessDeniedMessageFor(access: TelegramCommandAccess): string {
  if (access === 'approved') {
    return 'Necessites aprovacio del club abans de poder fer aquesta accio.';
  }

  if (access === 'admin') {
    return 'Aquesta accio nomes esta disponible per a administradors del club.';
  }

  return 'No tens permisos per fer aquesta accio.';
}

function restrictionMessageFor(contexts: TelegramChatContextKind[]): string {
  if (contexts.length === 1 && contexts[0] === 'private') {
    return 'Aquest comandament nomes esta disponible en xat privat.';
  }

  return 'Aquest comandament no esta disponible en aquest context de xat.';
}
