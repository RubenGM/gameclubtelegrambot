import { z } from 'zod';

import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { startTelegramEditableProgress } from './editable-progress.js';
import { normalizeBotLanguage, type BotLanguage } from './i18n.js';
import { LlmCommandServiceError } from './llm-command-service.js';
import {
  createAppMetadataLlmModelSettingsStore,
  defaultLlmModelSettings,
  selectionToGenerateJsonOptions,
} from './llm-model-settings.js';
import type { TelegramReplyOptions } from './runtime-boundary.js';

export const adminAiFlowKey = 'admin-ai';
export const adminAiCallbackPrefixes = {
  confirm: 'admin_ai:confirm',
  cancel: 'admin_ai:cancel',
} as const;

export const adminAiTargetValues = [
  'admin_menu',
  'schedule',
  'calendar',
  'tables_admin',
  'catalog',
  'catalog_search',
  'catalog_bulk',
  'loan_admin',
  'update_bgg',
  'storage',
  'group_purchases',
  'lfg',
  'role_games',
  'notices',
  'review_access',
  'manage_users',
  'welcome_templates',
  'venue_events',
  'printer_admin',
  'print',
  'llm_models',
  'member_menu',
  'language',
  'change_display_name',
  'subscribe_requests',
  'unsubscribe_requests',
  'status',
  'restart',
  'news',
  'autojoin',
  'help',
] as const;

const adminAiPlanSchema = z.object({
  version: z.literal(1),
  explanation: z.string().trim().min(1).max(1200),
  actions: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
  target: z.enum(adminAiTargetValues),
}).strict();

export type AdminAiTarget = typeof adminAiTargetValues[number];
export type AdminAiPlan = z.infer<typeof adminAiPlanSchema>;
export type AdminAiTargetExecutor = (
  context: TelegramCommandHandlerContext,
  plan: AdminAiPlan,
) => Promise<boolean>;

export async function handleTelegramAdminAiCommand(
  context: TelegramCommandHandlerContext,
): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  const texts = resolveAdminAiTexts(language);
  const userPrompt = parseAdminAiCommandText(context.messageText ?? '');

  if (!userPrompt) {
    await context.reply(texts.usage);
    return;
  }
  if (!context.runtime.actor.isAdmin || context.runtime.actor.isBlocked) {
    await context.reply(texts.adminOnly);
    return;
  }
  if (!context.runtime.llmCommandService?.generateJson) {
    await context.reply(texts.serviceMissing);
    return;
  }

  const progress = await startTelegramEditableProgress(
    context,
    texts.interpreting,
    { editFailedEvent: 'admin-ai.progress-edit.failed' },
    context.messageThreadId ? { messageThreadId: context.messageThreadId } : undefined,
  );

  try {
    const settings = await loadModelSettings(context);
    const rawPlan = await context.runtime.llmCommandService.generateJson(
      buildAdminAiPrompt({
        userPrompt,
        language,
        chatKind: context.runtime.chat.kind,
        hasTopic: Boolean(context.messageThreadId),
      }),
      'src/telegram/admin-ai-plan.schema.json',
      selectionToGenerateJsonOptions(settings.stronger),
    );
    const plan = parseAdminAiPlan(rawPlan);

    await context.runtime.session.start({
      flowKey: adminAiFlowKey,
      stepKey: 'confirm',
      data: {
        plan,
        userPrompt,
      },
    });
    await progress.complete(renderAdminAiConfirmation(plan, texts), buildAdminAiConfirmationOptions(texts));
  } catch (error) {
    context.runtime.logger?.warn?.({
      event: 'admin-ai.plan.failed',
      error: error instanceof Error ? error.message : String(error),
    }, 'Admin AI plan generation failed');
    await progress.complete(resolveAdminAiFailure(error, texts));
  }
}

export async function handleTelegramAdminAiCallback(
  context: TelegramCommandHandlerContext,
  executeTarget: AdminAiTargetExecutor,
): Promise<boolean> {
  const callbackData = context.callbackData;
  if (!callbackData || !Object.values(adminAiCallbackPrefixes).includes(callbackData as never)) {
    return false;
  }

  const texts = resolveAdminAiTexts(normalizeBotLanguage(context.runtime.bot.language, 'ca'));
  if (!context.runtime.actor.isAdmin || context.runtime.actor.isBlocked) {
    await context.reply(texts.adminOnly);
    return true;
  }

  const session = context.runtime.session.current;
  if (!session || session.flowKey !== adminAiFlowKey || session.stepKey !== 'confirm') {
    await context.reply(texts.stale);
    return true;
  }

  if (callbackData === adminAiCallbackPrefixes.cancel) {
    await context.runtime.session.cancel();
    await context.reply(texts.cancelled);
    return true;
  }

  const parsed = adminAiPlanSchema.safeParse(session.data.plan);
  if (!parsed.success) {
    await context.runtime.session.cancel();
    await context.reply(texts.planMissing);
    return true;
  }

  await context.runtime.session.cancel();
  await context.reply(texts.accepted);
  try {
    if (!(await executeTarget(context, parsed.data))) {
      await context.reply(texts.targetUnavailable);
    }
  } catch (error) {
    context.runtime.logger?.error({
      event: 'admin-ai.execute.failed',
      target: parsed.data.target,
      error: error instanceof Error ? error.message : String(error),
    }, 'Admin AI target execution failed');
    await context.reply(texts.executionFailed);
  }
  return true;
}

export function parseAdminAiPlan(value: unknown): AdminAiPlan {
  return adminAiPlanSchema.parse(value);
}

export function parseAdminAiCommandText(messageText: string): string | null {
  const match = messageText.trim().match(/^\/adminai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  const prompt = match?.[1]?.trim();
  return prompt || null;
}

function buildAdminAiPrompt({
  userPrompt,
  language,
  chatKind,
  hasTopic,
}: {
  userPrompt: string;
  language: BotLanguage;
  chatKind: string;
  hasTopic: boolean;
}): string {
  return [
    'You are the safe administrative intent planner for a Telegram club bot.',
    'Return only the JSON object required by the supplied schema.',
    `Write explanation and action descriptions in language: ${language}.`,
    `Current Telegram context: ${chatKind}${hasTopic ? ' with forum topic' : ''}.`,
    '',
    'Interpret the request, but select exactly one allowlisted target.',
    'The code will only open an existing guided bot flow or run an existing allowlisted command after explicit confirmation.',
    'Never invent parameters, identifiers, commands, shell operations, SQL, HTTP calls, or direct database changes.',
    'Use admin_menu when the request is vague, combines unrelated flows, or has no safe exact target.',
    'Choose restart only when the user explicitly asks to restart or reboot the bot.',
    'Choose update_bgg only when the user explicitly asks to update or synchronize BGG data.',
    'Choose news or autojoin only in a group context; use admin_menu for those requests in private.',
    'All other administrative menus are private-chat destinations; use help when the current context cannot safely open one.',
    '',
    'Targets:',
    '- admin_menu: open the general admin tools menu',
    '- schedule: manage club activities and agenda',
    '- calendar: show the calendar',
    '- tables_admin: manage club tables',
    '- catalog, catalog_search, catalog_bulk, loan_admin, update_bgg: catalog and loan tools',
    '- storage: storage categories, files and entries',
    '- group_purchases: group purchases',
    '- lfg: looking-for-group tools',
    '- role_games: role-playing game tools',
    '- notices: club notices',
    '- review_access, manage_users: memberships and users',
    '- welcome_templates: group welcome templates',
    '- venue_events: venue event administration',
    '- printer_admin, print: printer administration or print flow',
    '- llm_models: AI model settings',
    '- member_menu: preview the normal member menu',
    '- language, change_display_name: profile preferences',
    '- subscribe_requests, unsubscribe_requests: membership request alerts',
    '- status: send the feature status document',
    '- restart: restart the bot and clear temporary sessions',
    '- news, autojoin: group news subscriptions or automatic membership in the current group',
    '- help: contextual help',
    '',
    'The actions array must describe the concrete steps that will occur after confirmation.',
    'Do not use Markdown or HTML in explanation or actions.',
    '',
    `Administrator request: ${userPrompt}`,
  ].join('\n');
}

function renderAdminAiConfirmation(
  plan: AdminAiPlan,
  texts: ReturnType<typeof resolveAdminAiTexts>,
): string {
  return [
    texts.interpreted,
    plan.explanation,
    '',
    texts.actions,
    ...plan.actions.map((action, index) => `${index + 1}. ${action}`),
    '',
    texts.confirm,
  ].join('\n');
}

function buildAdminAiConfirmationOptions(
  texts: ReturnType<typeof resolveAdminAiTexts>,
): TelegramReplyOptions {
  return {
    inlineKeyboard: [[
      { text: texts.acceptButton, callbackData: adminAiCallbackPrefixes.confirm, semanticRole: 'success' },
      { text: texts.cancelButton, callbackData: adminAiCallbackPrefixes.cancel, semanticRole: 'danger' },
    ]],
  };
}

async function loadModelSettings(context: TelegramCommandHandlerContext) {
  try {
    return await createAppMetadataLlmModelSettingsStore({
      storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
    }).getSettings();
  } catch {
    return defaultLlmModelSettings;
  }
}

function resolveAdminAiFailure(
  error: unknown,
  texts: ReturnType<typeof resolveAdminAiTexts>,
): string {
  if (error instanceof LlmCommandServiceError && error.code === 'timeout') {
    return texts.timeout;
  }
  return texts.failed;
}

function resolveAdminAiTexts(language: BotLanguage) {
  if (language === 'ca') {
    return {
      usage: 'Ús: /adminai {què vols fer}',
      adminOnly: 'Aquest comandament només està disponible per a administradors.',
      serviceMissing: 'La IA administrativa no està disponible ara mateix.',
      interpreting: 'Interpretant la petició administrativa…',
      interpreted: 'He interpretat això:',
      actions: 'Accions previstes:',
      confirm: 'Vols continuar?',
      acceptButton: 'Acceptar',
      cancelButton: 'Cancel·lar',
      accepted: 'Confirmat. Obro el flux segur corresponent.',
      cancelled: 'Operació administrativa cancel·lada.',
      stale: 'Aquesta confirmació ja no és vigent. Torna a executar /adminai.',
      planMissing: 'No he pogut recuperar el pla administratiu. Torna a executar /adminai.',
      targetUnavailable: 'Aquesta opció no es pot obrir des del xat actual. Prova-ho al xat privat o al grup corresponent.',
      executionFailed: "No s'ha pogut obrir el flux administratiu seleccionat.",
      timeout: 'La IA ha trigat massa a interpretar la petició. Torna-ho a provar.',
      failed: 'No he pogut preparar un pla administratiu segur. No s’ha executat cap acció.',
    };
  }
  if (language === 'en') {
    return {
      usage: 'Usage: /adminai {what you want to do}',
      adminOnly: 'This command is only available to administrators.',
      serviceMissing: 'Administrative AI is not available right now.',
      interpreting: 'Interpreting the administrative request…',
      interpreted: 'I interpreted this:',
      actions: 'Planned actions:',
      confirm: 'Do you want to continue?',
      acceptButton: 'Accept',
      cancelButton: 'Cancel',
      accepted: 'Confirmed. Opening the corresponding safe flow.',
      cancelled: 'Administrative operation cancelled.',
      stale: 'This confirmation is no longer valid. Run /adminai again.',
      planMissing: 'I could not recover the administrative plan. Run /adminai again.',
      targetUnavailable: 'This option cannot be opened from the current chat. Try the private chat or the relevant group.',
      executionFailed: 'The selected administrative flow could not be opened.',
      timeout: 'The AI took too long to interpret the request. Please try again.',
      failed: 'I could not prepare a safe administrative plan. No action was executed.',
    };
  }
  return {
    usage: 'Uso: /adminai {qué quieres hacer}',
    adminOnly: 'Este comando solo está disponible para administradores.',
    serviceMissing: 'La IA administrativa no está disponible ahora mismo.',
    interpreting: 'Interpretando la petición administrativa…',
    interpreted: 'He interpretado esto:',
    actions: 'Acciones previstas:',
    confirm: '¿Quieres continuar?',
    acceptButton: 'Aceptar',
    cancelButton: 'Cancelar',
    accepted: 'Confirmado. Abro el flujo seguro correspondiente.',
    cancelled: 'Operación administrativa cancelada.',
    stale: 'Esta confirmación ya no es válida. Vuelve a ejecutar /adminai.',
    planMissing: 'No he podido recuperar el plan administrativo. Vuelve a ejecutar /adminai.',
    targetUnavailable: 'Esta opción no se puede abrir desde el chat actual. Pruébalo en el chat privado o en el grupo correspondiente.',
    executionFailed: 'No se ha podido abrir el flujo administrativo seleccionado.',
    timeout: 'La IA ha tardado demasiado en interpretar la petición. Inténtalo de nuevo.',
    failed: 'No he podido preparar un plan administrativo seguro. No se ha ejecutado ninguna acción.',
  };
}
