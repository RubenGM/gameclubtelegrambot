import {
  createAppMetadataRoleGameAutoSchedulingStore,
  maxRoleGameAutoSchedulingMaxFutureWeeks,
  minRoleGameAutoSchedulingMaxFutureWeeks,
  type RoleGameAutoSchedulingStore,
} from '../role-games/role-game-auto-scheduling-store.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { roleGameAutoSchedulingAdminTexts } from './i18n-role-game-auto-scheduling-admin.js';
import { escapeHtml } from './schedule-presentation.js';

export const roleGameAutoSchedulingAdminFlowKey = 'role-game-auto-scheduling-admin';

export const roleGameAutoSchedulingAdminCallbackPrefixes = {
  open: 'role_auto_settings:open',
  enable: 'role_auto_settings:enable',
  confirmEnable: 'role_auto_settings:confirm_enable:',
  disable: 'role_auto_settings:disable',
  weeks: 'role_auto_settings:weeks:',
  confirmWeeks: 'role_auto_settings:confirm_weeks:',
  customWeeks: 'role_auto_settings:weeks_custom',
} as const;

type RoleGameAutoSchedulingAdminContext = TelegramCommandHandlerContext & {
  roleGameAutoSchedulingStore?: RoleGameAutoSchedulingStore;
};

const weekPresets = [1, 2, 4, 8, 12] as const;

export async function handleTelegramRoleGameAutoSchedulingAdminText(
  context: RoleGameAutoSchedulingAdminContext,
): Promise<boolean> {
  const text = context.messageText?.trim();
  if (!text) return false;

  const language = resolveLanguage(context);
  const session = context.runtime.session.current;
  const isOurSession = session?.flowKey === roleGameAutoSchedulingAdminFlowKey;
  const isMenuEntry = supportedMenuLabels().includes(text);

  if (!isOurSession && !isMenuEntry) return false;
  if (!canManage(context)) {
    await context.reply(createTelegramI18n(language).common.accessDeniedAdmin);
    return true;
  }

  if (isOurSession && session?.stepKey === 'max-future-weeks') {
    const weeks = parseWeeks(text);
    if (weeks === null) {
      await context.reply(roleGameAutoSchedulingAdminTexts[language].invalidWeeks);
      return true;
    }

    const store = resolveStore(context);
    const settings = await store.getSettings();
    await context.runtime.session.cancel();
    await applyOrConfirmFutureWeeks(context, store, settings, weeks, language);
    return true;
  }

  await sendTelegramRoleGameAutoSchedulingAdminMenu(context);
  return true;
}

export async function handleTelegramRoleGameAutoSchedulingAdminCallback(
  context: RoleGameAutoSchedulingAdminContext,
): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || !isRoleGameAutoSchedulingAdminCallback(callbackData)) return false;

  const language = resolveLanguage(context);
  if (!canManage(context)) {
    await context.reply(createTelegramI18n(language).common.accessDeniedAdmin);
    return true;
  }

  const store = resolveStore(context);
  const texts = roleGameAutoSchedulingAdminTexts[language];

  if (callbackData === roleGameAutoSchedulingAdminCallbackPrefixes.open) {
    await sendTelegramRoleGameAutoSchedulingAdminMenu(context);
    return true;
  }

  if (callbackData === roleGameAutoSchedulingAdminCallbackPrefixes.enable) {
    const settings = await store.getSettings();
    await replyWithEnableConfirmation(context, settings.maxFutureWeeks, language);
    return true;
  }

  if (callbackData.startsWith(roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable)) {
    const expectedWeeks = parseWeeks(callbackData.slice(roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable.length));
    if (expectedWeeks === null) return false;
    const currentSettings = await store.getSettings();
    if (currentSettings.enabled) {
      await sendTelegramRoleGameAutoSchedulingAdminMenu(context);
      return true;
    }
    if (currentSettings.maxFutureWeeks !== expectedWeeks) {
      await replyWithEnableConfirmation(context, currentSettings.maxFutureWeeks, language);
      return true;
    }
    await store.setEnabled(true);
    await sendTelegramRoleGameAutoSchedulingAdminMenu(context, texts.enabledSaved);
    return true;
  }

  if (callbackData === roleGameAutoSchedulingAdminCallbackPrefixes.disable) {
    await store.setEnabled(false);
    await sendTelegramRoleGameAutoSchedulingAdminMenu(context, texts.disabledSaved);
    return true;
  }

  if (callbackData === roleGameAutoSchedulingAdminCallbackPrefixes.customWeeks) {
    await context.runtime.session.start({
      flowKey: roleGameAutoSchedulingAdminFlowKey,
      stepKey: 'max-future-weeks',
      data: {},
    });
    await context.reply(texts.customWeeksPrompt);
    return true;
  }

  if (callbackData.startsWith(roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks)) {
    const weeks = parseWeeks(callbackData.slice(roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks.length));
    if (weeks === null) return false;
    await store.setMaxFutureWeeks(weeks);
    await sendTelegramRoleGameAutoSchedulingAdminMenu(
      context,
      format(texts.weeksSaved, { weeks: formatWeeks(weeks, language) }),
    );
    return true;
  }

  if (callbackData.startsWith(roleGameAutoSchedulingAdminCallbackPrefixes.weeks)) {
    const weeks = parseWeeks(callbackData.slice(roleGameAutoSchedulingAdminCallbackPrefixes.weeks.length));
    if (weeks === null) return false;
    const settings = await store.getSettings();
    await applyOrConfirmFutureWeeks(context, store, settings, weeks, language);
    return true;
  }

  return false;
}

export async function sendTelegramRoleGameAutoSchedulingAdminMenu(
  context: RoleGameAutoSchedulingAdminContext,
  confirmation?: string,
): Promise<void> {
  const language = resolveLanguage(context);
  const texts = roleGameAutoSchedulingAdminTexts[language];
  const settings = await resolveStore(context).getSettings();
  const message = [
    confirmation ? escapeHtml(confirmation) : null,
    confirmation ? '' : null,
    `<b>${escapeHtml(texts.title)}</b>`,
    '',
    `${escapeHtml(texts.enabledLabel)}: <b>${escapeHtml(settings.enabled ? texts.enabled : texts.disabled)}</b>`,
    `${escapeHtml(texts.horizonLabel)}: <b>${escapeHtml(formatWeeks(settings.maxFutureWeeks, language))}</b>`,
    '',
    escapeHtml(texts.liveNote),
  ].filter((line): line is string => line !== null).join('\n');

  await context.reply(message, {
    parseMode: 'HTML',
    inlineKeyboard: buildSettingsKeyboard(settings.enabled, language),
  });
}

function buildSettingsKeyboard(enabled: boolean, language: BotLanguage) {
  const texts = roleGameAutoSchedulingAdminTexts[language];
  return [
    [{
      text: enabled ? texts.disableButton : texts.enableButton,
      callbackData: enabled
        ? roleGameAutoSchedulingAdminCallbackPrefixes.disable
        : roleGameAutoSchedulingAdminCallbackPrefixes.enable,
      semanticRole: enabled ? 'danger' as const : 'success' as const,
    }],
    weekPresets.slice(0, 3).map((weeks) => ({
      text: formatWeeks(weeks, language),
      callbackData: `${roleGameAutoSchedulingAdminCallbackPrefixes.weeks}${weeks}`,
      semanticRole: 'secondary' as const,
    })),
    [
      ...weekPresets.slice(3).map((weeks) => ({
        text: formatWeeks(weeks, language),
        callbackData: `${roleGameAutoSchedulingAdminCallbackPrefixes.weeks}${weeks}`,
        semanticRole: 'secondary' as const,
      })),
      {
        text: texts.customWeeksButton,
        callbackData: roleGameAutoSchedulingAdminCallbackPrefixes.customWeeks,
        semanticRole: 'primary' as const,
      },
    ],
    [{
      text: texts.refreshButton,
      callbackData: roleGameAutoSchedulingAdminCallbackPrefixes.open,
      semanticRole: 'navigation' as const,
    }],
  ];
}

function resolveStore(context: RoleGameAutoSchedulingAdminContext): RoleGameAutoSchedulingStore {
  return context.roleGameAutoSchedulingStore ?? createAppMetadataRoleGameAutoSchedulingStore({
    storage: createDatabaseAppMetadataSessionStorage({
      database: context.runtime.services.database.db,
    }),
  });
}

function canManage(context: RoleGameAutoSchedulingAdminContext): boolean {
  return context.runtime.chat.kind === 'private'
    && context.runtime.actor.isAdmin
    && !context.runtime.actor.isBlocked;
}

async function applyOrConfirmFutureWeeks(
  context: RoleGameAutoSchedulingAdminContext,
  store: RoleGameAutoSchedulingStore,
  settings: { enabled: boolean; maxFutureWeeks: number },
  weeks: number,
  language: BotLanguage,
): Promise<void> {
  const texts = roleGameAutoSchedulingAdminTexts[language];
  if (settings.enabled && weeks > settings.maxFutureWeeks) {
    await context.reply(format(texts.increaseConfirmation, {
      currentWeeks: formatWeeks(settings.maxFutureWeeks, language),
      newWeeks: formatWeeks(weeks, language),
    }), {
      inlineKeyboard: [[
        {
          text: texts.confirmWeeksButton,
          callbackData: `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmWeeks}${weeks}`,
          semanticRole: 'success',
        },
        {
          text: texts.cancelButton,
          callbackData: roleGameAutoSchedulingAdminCallbackPrefixes.open,
          semanticRole: 'danger',
        },
      ]],
    });
    return;
  }

  await store.setMaxFutureWeeks(weeks);
  await sendTelegramRoleGameAutoSchedulingAdminMenu(
    context,
    format(texts.weeksSaved, { weeks: formatWeeks(weeks, language) }),
  );
}

async function replyWithEnableConfirmation(
  context: RoleGameAutoSchedulingAdminContext,
  expectedWeeks: number,
  language: BotLanguage,
): Promise<void> {
  const texts = roleGameAutoSchedulingAdminTexts[language];
  await context.reply(format(texts.enableConfirmation, {
    weeks: formatWeeks(expectedWeeks, language),
  }), {
    inlineKeyboard: [[
      {
        text: texts.confirmEnableButton,
        callbackData: `${roleGameAutoSchedulingAdminCallbackPrefixes.confirmEnable}${expectedWeeks}`,
        semanticRole: 'success',
      },
      {
        text: texts.cancelButton,
        callbackData: roleGameAutoSchedulingAdminCallbackPrefixes.open,
        semanticRole: 'danger',
      },
    ]],
  });
}

function resolveLanguage(context: RoleGameAutoSchedulingAdminContext): BotLanguage {
  return normalizeBotLanguage(context.runtime.bot.language, 'ca');
}

function supportedMenuLabels(): string[] {
  return (['ca', 'es', 'en'] as const).map((language) => createTelegramI18n(language).actionMenu.roleGameAutoScheduling);
}

function isRoleGameAutoSchedulingAdminCallback(callbackData: string): boolean {
  return Object.values(roleGameAutoSchedulingAdminCallbackPrefixes).some((prefix) => callbackData.startsWith(prefix));
}

function parseWeeks(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const weeks = Number(value);
  return Number.isInteger(weeks)
    && weeks >= minRoleGameAutoSchedulingMaxFutureWeeks
    && weeks <= maxRoleGameAutoSchedulingMaxFutureWeeks
    ? weeks
    : null;
}

function formatWeeks(weeks: number, language: BotLanguage): string {
  const texts = roleGameAutoSchedulingAdminTexts[language];
  return weeks === 1 ? texts.week : format(texts.weeks, { count: String(weeks) });
}

function format(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}
