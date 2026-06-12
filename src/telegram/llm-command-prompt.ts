import type { BotLanguage } from './i18n.js';
import { listAllowedLlmCommandCapabilities, type LlmCommandCapability } from './llm-command-actions.js';
import type { TelegramChatContextKind } from './chat-context.js';

export interface LlmCommandPromptInput {
  userText: string;
  language: BotLanguage;
  isApproved: boolean;
  isAdmin: boolean;
  chatKind: TelegramChatContextKind;
  hasTopic: boolean;
  history?: Array<{ role: 'user' | 'assistant'; intent?: string; text: string }>;
  maxPromptChars?: number;
}

export function buildLlmCommandPrompt(input: LlmCommandPromptInput): string {
  const capabilities = listAllowedLlmCommandCapabilities({
    isApproved: input.isApproved,
    isAdmin: input.isAdmin,
    chatKind: input.chatKind,
    includeWrites: input.chatKind === 'private',
  });
  const lines = [
    'Eres el interprete de ordenes naturales del bot de un club.',
    'Tu unica tarea es convertir el mensaje del usuario en JSON valido con version 1.',
    'No ejecutes nada, no inventes acciones y no escribas texto fuera del JSON.',
    'Si faltan datos, devuelve ask_clarification. Si la accion cambia algo, marca requiresConfirmation=true.',
    'Para consultas de datos del bot usa action.type=call_internal_handler, requiresConfirmation=false y safety.risk=read_only.',
    'No uses answer_directly para agenda, catalogo, Storage, prestamos, avisos, compras, LFG o noticias; el bot consultara sus repositorios internos.',
    'Para "esta semana" en agenda usa intent=schedule.search y params.dateRange="this_week".',
    'Distingue catalogo y Storage: catalogo son articulos fisicos/prestables del club; Storage son archivos o material subido.',
    'Storage puede contener STL para impresion 3D y material de juegos de rol como libros, manuales, aventuras, fichas, mapas, ayudas, imagenes o cualquier otro archivo.',
    'Si el usuario pide libros de rol, material de rol, aventuras, fichas, mapas, PDFs, documentos, archivos, STL o contenido subido, usa storage.search salvo que pida explicitamente un item fisico/prestable del catalogo.',
    'Las acciones administrativas no se ejecutan por IA: marca requiresAdmin=true y usa unsupported.',
    '',
    'Contexto del usuario:',
    `- idioma preferido: ${input.language}`,
    `- aprobado: ${input.isApproved}`,
    `- admin: ${input.isAdmin}`,
    `- chat: ${input.chatKind}${input.hasTopic ? ' con topic' : ''}`,
    '',
    'Acciones permitidas:',
    ...capabilities.map(formatCapabilityLine),
    '',
    'Formato JSON obligatorio:',
    '{"version":1,"language":"es","intent":"help.capabilities","confidence":0.95,"reply":{"text":"...","sendNow":false},"needsClarification":false,"clarification":null,"requiresConfirmation":false,"confirmation":null,"action":{"type":"call_internal_handler","name":"help.capabilities","params":{}},"safety":{"requiresApprovedMember":false,"requiresAdmin":false,"risk":"read_only","publicSideEffect":false,"destructive":false,"requiresPrivateChat":false}}',
  ];

  if (input.history && input.history.length > 0) {
    lines.push('', 'Historial de esta sesion LLM:');
    for (const entry of input.history) {
      lines.push(`- ${entry.role}${entry.intent ? `/${entry.intent}` : ''}: ${entry.text}`);
    }
  }

  lines.push('', 'Mensaje actual del usuario:', input.userText);

  const prompt = lines.join('\n');
  const maxPromptChars = input.maxPromptChars ?? 12000;
  if (prompt.length <= maxPromptChars) {
    return prompt;
  }

  const trimmedUserText = input.userText.slice(0, Math.max(200, Math.floor(maxPromptChars / 3)));
  const trimmedPrompt = buildLlmCommandPrompt({
    ...input,
    userText: trimmedUserText,
    history: [],
    maxPromptChars: Number.MAX_SAFE_INTEGER,
  });
  return trimmedPrompt.slice(0, maxPromptChars);
}

function formatCapabilityLine(capability: LlmCommandCapability): string {
  return `- ${capability.intent}: ${capability.description}; riesgo=${capability.risk}; privado=${capability.allowedChatKinds.includes('private')}`;
}
