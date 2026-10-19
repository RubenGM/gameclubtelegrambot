import {
  createAppMetadataFoundrySettingsStore,
  foundryConnectionMessageMaxLength,
  type FoundrySettingsStore,
} from '../role-games/role-game-foundry-settings.js';
import type { TelegramCommandHandlerContext } from './command-registry.js';
import { createDatabaseAppMetadataSessionStorage } from './conversation-session-store.js';
import { createTelegramI18n, normalizeBotLanguage } from './i18n.js';
import { escapeHtml } from './schedule-presentation.js';
import { renderTelegramMessageTextAsHtml } from './telegram-entity-html.js';

export const foundryAdminFlowKey = 'foundry-admin';
export const foundryAdminCallbackPrefix = 'foundry_admin:';

type Context = TelegramCommandHandlerContext & { foundrySettingsStore?: FoundrySettingsStore };

export async function handleTelegramFoundryCommand(context: Context): Promise<void> {
  const language = normalizeBotLanguage(context.runtime.bot.language, 'ca');
  if (context.runtime.actor.isBlocked || !context.runtime.actor.isApproved) {
    await context.reply(createTelegramI18n(language).common.accessDeniedApproved);
    return;
  }
  await replyWithConnectionMessage(context);
}

export async function openTelegramFoundryAdmin(context: Context, saved = false): Promise<void> {
  if (!await requireAdmin(context)) return;
  const t = texts[normalizeBotLanguage(context.runtime.bot.language, 'ca')];
  const message = await connectionMessage(context);
  await context.reply([saved ? t.saved : undefined, `<b>${t.title}</b>`, t.explanation, '', message].filter((line) => line !== undefined).join('\n'), {
    parseMode: 'HTML',
    inlineKeyboard: [[
      { text: t.edit, callbackData: `${foundryAdminCallbackPrefix}edit` },
      { text: t.preview, callbackData: `${foundryAdminCallbackPrefix}preview` },
    ]],
  });
}

export async function handleTelegramFoundryAdminCallback(context: Context): Promise<boolean> {
  if (!context.callbackData?.startsWith(foundryAdminCallbackPrefix)) return false;
  if (!await requireAdmin(context)) return true;
  const t = texts[normalizeBotLanguage(context.runtime.bot.language, 'ca')];
  const session = context.runtime.session.current;
  if (session && session.flowKey !== foundryAdminFlowKey) {
    await context.reply(t.finishFlow);
    return true;
  }
  const action = context.callbackData.slice(foundryAdminCallbackPrefix.length);
  if (action === 'edit') {
    await context.runtime.session.start({ flowKey: foundryAdminFlowKey, stepKey: 'message', data: {} });
    await context.reply(t.prompt, {
      inlineKeyboard: [[{ text: t.cancel, callbackData: `${foundryAdminCallbackPrefix}cancel` }]],
    });
    return true;
  }
  if (action === 'preview') {
    await replyWithConnectionMessage(context);
    return true;
  }
  if (action === 'cancel') {
    if (session?.flowKey === foundryAdminFlowKey) await context.runtime.session.cancel();
    await openTelegramFoundryAdmin(context);
    return true;
  }
  return false;
}

export async function handleTelegramFoundryAdminText(context: Context): Promise<boolean> {
  const session = context.runtime.session.current;
  if (session?.flowKey !== foundryAdminFlowKey || session.stepKey !== 'message') return false;
  if (!await requireAdmin(context)) return true;
  const text = context.messageText;
  if (!text?.trim() || text.length > foundryConnectionMessageMaxLength) {
    await context.reply(texts[normalizeBotLanguage(context.runtime.bot.language, 'ca')].invalid);
    return true;
  }
  await resolveStore(context).set({ text, html: renderTelegramMessageTextAsHtml(text, context.messageEntities) });
  await context.runtime.session.cancel();
  await openTelegramFoundryAdmin(context, true);
  return true;
}

async function replyWithConnectionMessage(context: Context): Promise<void> {
  await context.reply(await connectionMessage(context), { parseMode: 'HTML' });
}

async function connectionMessage(context: Context): Promise<string> {
  const saved = await resolveStore(context).get();
  return saved?.html ?? escapeHtml(saved?.text ?? texts[normalizeBotLanguage(context.runtime.bot.language, 'ca')].defaultMessage);
}

function resolveStore(context: Context): FoundrySettingsStore {
  return context.foundrySettingsStore ?? createAppMetadataFoundrySettingsStore({
    storage: createDatabaseAppMetadataSessionStorage({ database: context.runtime.services.database.db }),
  });
}

async function requireAdmin(context: Context): Promise<boolean> {
  if (context.runtime.chat.kind === 'private' && context.runtime.actor.isAdmin && !context.runtime.actor.isBlocked) return true;
  await context.reply(createTelegramI18n(normalizeBotLanguage(context.runtime.bot.language, 'ca')).common.accessDeniedAdmin);
  return false;
}

const texts = {
  ca: {
    title: 'Foundry · missatge de connexió',
    explanation: 'Aquest és el missatge que veuran els socis amb /foundry. Els canvis s’apliquen al moment en tots els idiomes.',
    edit: 'Editar missatge', preview: 'Previsualitzar', cancel: 'Cancel·lar edició',
    prompt: 'Envia el nou missatge de connexió (màxim 3500 caràcters). Pots incloure enllaços i format de Telegram, com negreta o cursiva. /cancel per sortir sense desar.',
    invalid: 'Envia un missatge de text entre 1 i 3500 caràcters.',
    saved: 'Missatge de Foundry desat.', finishFlow: 'Acaba o cancel·la el procés actual abans d’editar Foundry.',
    defaultMessage: '🎲 Connectar a Foundry VTT\n\n1. Obre https://cawa.hopto.org/foundry/ al navegador, preferiblement des d’un ordinador.\n2. Quan el màster hagi obert el món de la partida, selecciona el teu usuari i introdueix la clau que t’hagi facilitat, si cal.\n3. Entra a la partida.\n\nSi no apareix la partida o no tens usuari, contacta amb el màster.',
  },
  es: {
    title: 'Foundry · mensaje de conexión',
    explanation: 'Este es el mensaje que verán los socios con /foundry. Los cambios se aplican al momento en todos los idiomas.',
    edit: 'Editar mensaje', preview: 'Previsualizar', cancel: 'Cancelar edición',
    prompt: 'Envía el nuevo mensaje de conexión (máximo 3500 caracteres). Puedes incluir enlaces y formato de Telegram, como negrita o cursiva. /cancel para salir sin guardar.',
    invalid: 'Envía un mensaje de texto entre 1 y 3500 caracteres.',
    saved: 'Mensaje de Foundry guardado.', finishFlow: 'Termina o cancela el proceso actual antes de editar Foundry.',
    defaultMessage: '🎲 Conectar a Foundry VTT\n\n1. Abre https://cawa.hopto.org/foundry/ en el navegador, preferiblemente desde un ordenador.\n2. Cuando el máster haya abierto el mundo de la partida, selecciona tu usuario e introduce la clave que te haya facilitado, si hace falta.\n3. Entra en la partida.\n\nSi no aparece la partida o no tienes usuario, contacta con el máster.',
  },
  en: {
    title: 'Foundry · connection message',
    explanation: 'Members will see this message with /foundry. Changes take effect immediately in all languages.',
    edit: 'Edit message', preview: 'Preview', cancel: 'Cancel editing',
    prompt: 'Send the new connection message (up to 3500 characters). You can include links and Telegram formatting such as bold or italic. /cancel to leave without saving.',
    invalid: 'Send a text message between 1 and 3500 characters.',
    saved: 'Foundry message saved.', finishFlow: 'Finish or cancel the current process before editing Foundry.',
    defaultMessage: '🎲 Connect to Foundry VTT\n\n1. Open https://cawa.hopto.org/foundry/ in your browser, preferably on a computer.\n2. Once the GM has launched the game world, select your user and enter the access key they provided, if required.\n3. Join the game.\n\nIf the game is unavailable or you do not have a user, contact the GM.',
  },
} as const;
