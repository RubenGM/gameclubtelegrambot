import { createDatabaseGroupPurchaseRepository } from '../group-purchases/group-purchase-catalog-store.js';
import type { GroupPurchaseRepository } from '../group-purchases/group-purchase-catalog.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { buildGroupPurchaseMenuOptions, groupPurchaseLabels } from './group-purchase-keyboards.js';
import { formatGroupPurchaseDetailMessage, formatGroupPurchaseListMessage } from './group-purchase-presentation.js';

export type TelegramGroupPurchaseContext = TelegramCommandHandlerContext & {
  groupPurchaseRepository?: GroupPurchaseRepository;
};

export async function handleTelegramGroupPurchaseCommand(context: TelegramGroupPurchaseContext): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  await context.reply(createTelegramI18n(language).groupPurchases.selectMenu, buildGroupPurchaseMenuOptions(language));
}

export async function handleTelegramGroupPurchaseText(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const text = context.messageText?.trim();
  if (
    !text ||
    context.runtime.chat.kind !== 'private' ||
    !context.runtime.actor.isApproved ||
    context.runtime.actor.isBlocked
  ) {
    return false;
  }

  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const i18n = createTelegramI18n(language);
  const texts = i18n.groupPurchases;

  if (text === i18n.actionMenu.groupPurchases || text === groupPurchaseLabels.openMenu || text === '/group_purchases') {
    await handleTelegramGroupPurchaseCommand(context);
    return true;
  }

  if (text === texts.list || text === groupPurchaseLabels.list) {
    const purchases = await resolveRepository(context).listPurchases();
    await context.reply(
      purchases.length === 0 ? texts.noPurchases : formatGroupPurchaseListMessage({ purchases, language }),
      {
        ...buildGroupPurchaseMenuOptions(language),
        ...(purchases.length > 0 ? { parseMode: 'HTML' as const } : {}),
      },
    );
    return true;
  }

  if (text === texts.create || text === groupPurchaseLabels.create) {
    await context.reply(texts.createUnavailable, buildGroupPurchaseMenuOptions(language));
    return true;
  }

  return false;
}

export async function handleTelegramGroupPurchaseStartText(context: TelegramGroupPurchaseContext): Promise<boolean> {
  const purchaseId = parseStartPayload(context.messageText, 'group_purchase_');
  if (purchaseId === null || context.runtime.chat.kind !== 'private' || !context.runtime.actor.isApproved) {
    return false;
  }

  const detail = await resolveRepository(context).getPurchaseDetail(purchaseId);
  if (!detail) {
    throw new Error(`Group purchase ${purchaseId} not found`);
  }

  await context.reply(formatGroupPurchaseDetailMessage({ detail, language: normalizeBotLanguage(context.runtime.bot.language, 'ca') }), {
    parseMode: 'HTML',
  });
  return true;
}

function resolveRepository(context: TelegramGroupPurchaseContext): GroupPurchaseRepository {
  if (context.groupPurchaseRepository) {
    return context.groupPurchaseRepository;
  }

  return createDatabaseGroupPurchaseRepository({
    database: context.runtime.services.database.db as never,
  });
}

function parseStartPayload(messageText: string | undefined, prefix: string): number | null {
  const payload = messageText?.trim().split(/\s+/).slice(1).join(' ');
  if (!payload || !payload.startsWith(prefix)) {
    return null;
  }

  const value = Number(payload.slice(prefix.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}
