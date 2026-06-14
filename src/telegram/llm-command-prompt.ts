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
  replyContext?: { messageId?: number; text?: string };
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
	    'Devuelve progress.messages con 0 a 4 textos cortos, naturales y especificos que el bot pueda mostrar mientras consulta datos o prepara la respuesta. No incluyas datos no verificados; usa mensajes como "Voy a revisar Storage y filtrar por STL".',
	    'Puedes usar general.answer con action.type=answer_directly para preguntas generales o conversacionales que no necesiten datos internos del bot.',
    'No uses answer_directly para agenda, catalogo, Storage, prestamos, avisos, compras, LFG o noticias; el bot consultara sus repositorios internos y podra pedir una segunda pasada LLM con datos reales.',
    'Si el usuario pregunta de forma transversal ("que tenemos de X", "hay algo de X", "cosas de X", "contenido de X") o no queda claro si debe buscar en catalogo, Storage, agenda, compras, avisos o LFG, usa intent=bot.search.',
    'Para bot.search pon params.query con el tema buscado y, si el usuario limita fuentes, params.sources con valores de: schedule, catalog, storage, group_purchases, notices, lfg. Si no limita fuentes, usa sources=[].',
    'Para "esta semana" en agenda usa intent=schedule.search y params.dateRange="this_week".',
    'Distingue catalogo y Storage: catalogo son articulos fisicos/prestables del club; Storage son archivos o material subido.',
    'Para recomendaciones de juegos de mesa del catalogo usa catalog.recommend. Extrae playerCount si el usuario dice "4 personas", "cuatro jugadores", etc. Si pide disponible, marca availableOnly=true. Para juegos de mesa usa itemType="board-game".',
    'Para busquedas de catalogo con filtros concretos tambien puedes usar catalog.search con playerCount, availableOnly e itemType; no metas esos filtros dentro de query.',
    'Si el usuario responde a un mensaje del bot, usa ese texto como contexto conversacional para decidir la capacidad y los parametros; si el titulo o dato necesario aparece en el reply, reutilizalo.',
    'Cuando la pregunta requiera interpretar datos recuperados del bot, elige la capacidad de lectura mas adecuada; el bot consultara datos reales y podra devolvertelos en una segunda pasada para redactar la respuesta final.',
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
	    '{"version":1,"language":"es","intent":"help.capabilities","confidence":0.95,"reply":{"text":"...","sendNow":false},"progress":{"messages":[]},"needsClarification":false,"clarification":null,"requiresConfirmation":false,"confirmation":null,"action":{"type":"call_internal_handler","name":"help.capabilities","params":{"query":null,"dateRange":null,"tag":null,"fileExtensions":[],"id":null,"noticeId":null,"entryId":null,"categoryId":null,"itemId":null,"eventId":null,"purchaseId":null,"title":null,"text":null,"message":null,"body":null,"content":null,"description":null,"playerCount":null,"availableOnly":null,"itemType":null,"expiresAt":null,"startsAt":null,"groupTitle":null,"sources":[]}},"safety":{"requiresApprovedMember":false,"requiresAdmin":false,"risk":"read_only","publicSideEffect":false,"destructive":false,"requiresPrivateChat":false}}',
  ];

  if (input.history && input.history.length > 0) {
    lines.push('', 'Historial de esta sesion LLM:');
    for (const entry of input.history) {
      lines.push(`- ${entry.role}${entry.intent ? `/${entry.intent}` : ''}: ${entry.text}`);
    }
  }

  if (input.replyContext) {
    lines.push('', 'Mensaje del bot al que responde el usuario:');
    if (input.replyContext.messageId !== undefined) {
      lines.push(`- messageId: ${input.replyContext.messageId}`);
    }
    lines.push(`- texto: ${input.replyContext.text ?? '(sin texto disponible)'}`);
    lines.push('Usa este mensaje solo como contexto conversacional; la petición actual del usuario manda.');
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
