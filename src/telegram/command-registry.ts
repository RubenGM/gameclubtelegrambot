import type { InfrastructureRuntimeServices } from '../infrastructure/runtime-boundary.js';
import type { TelegramChatContext, TelegramChatContextKind } from './chat-context.js';

export interface TelegramCommandRuntime {
  bot: {
    publicName: string;
    clubName: string;
  };
  services: InfrastructureRuntimeServices;
  chat: TelegramChatContext;
}

export interface TelegramCommandHandlerContext {
  reply(message: string): Promise<unknown>;
  runtime: TelegramCommandRuntime;
  __replies?: string[];
}

export type TelegramCommandHandler = (
  context: TelegramCommandHandlerContext,
) => Promise<unknown> | unknown;

export interface TelegramCommandDefinition {
  command: string;
  contexts: TelegramChatContextKind[];
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

      await command.handle(context);
    });
  }
}

function restrictionMessageFor(contexts: TelegramChatContextKind[]): string {
  if (contexts.length === 1 && contexts[0] === 'private') {
    return 'Aquest comandament nomes esta disponible en xat privat.';
  }

  return 'Aquest comandament no esta disponible en aquest context de xat.';
}
