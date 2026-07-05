import type { TelegramChatContextKind } from './chat-context.js';

export const llmCommandIntentValues = [
  'help.capabilities',
  'general.answer',
  'bot.search',
  'schedule.today',
  'schedule.upcoming',
  'schedule.search',
  'schedule.create',
  'schedule.join',
  'schedule.leave',
  'catalog.search',
  'catalog.detail',
  'catalog.recommend',
  'catalog.create',
  'catalog.edit',
  'catalog.loan.create',
  'catalog.loan.list',
  'storage.search',
  'storage.category.list',
  'storage.upload.start',
  'storage.entry.detail',
  'storage.entry.edit',
  'notice.list',
  'notice.create',
  'notice.archive',
  'group_purchase.list',
  'group_purchase.detail',
  'group_purchase.join',
  'group_purchase.create',
  'lfg.list',
  'lfg.create',
  'news.status',
  'clarify',
  'unsupported',
] as const;

export type LlmCommandIntent = typeof llmCommandIntentValues[number];

export type LlmCommandRisk = 'read_only' | 'write' | 'admin' | 'unknown';

export interface LlmCommandCapability {
  intent: LlmCommandIntent;
  description: string;
  risk: LlmCommandRisk;
  requiresApprovedMember: boolean;
  requiresAdmin: boolean;
  allowedChatKinds: TelegramChatContextKind[];
}

export const llmCommandCapabilities: LlmCommandCapability[] = [
  capability('help.capabilities', 'explicar que puede hacer el bot', 'read_only', false),
  capability('general.answer', 'responder preguntas generales o conversacionales que no requieren datos internos del bot', 'read_only', false),
  capability('bot.search', 'buscar una misma consulta en varias fuentes del bot y devolver una respuesta agrupada con enlaces', 'read_only', true),
  capability('schedule.today', 'consultar actividades de hoy', 'read_only', true),
  capability('schedule.upcoming', 'consultar proximas actividades', 'read_only', true),
  capability('schedule.search', 'buscar actividades por fecha, mesa, juego, organizador o plazas', 'read_only', true),
  capability('schedule.create', 'crear una actividad mediante el flujo normal', 'write', true, false, ['private']),
  capability('schedule.join', 'unirse a una actividad', 'write', true, false, ['private']),
  capability('schedule.leave', 'salir de una actividad', 'write', true, false, ['private']),
  capability('catalog.search', 'buscar items del catalogo por texto o filtros simples como jugadores y disponibilidad', 'read_only', true),
  capability('catalog.detail', 'consultar detalle de un item del catalogo', 'read_only', true),
  capability('catalog.recommend', 'recomendar uno o varios juegos de mesa del catalogo usando filtros como jugadores y disponibilidad', 'read_only', true),
  capability('catalog.create', 'crear items del catalogo desde flujo normal', 'admin', true, true, ['private']),
  capability('catalog.edit', 'editar items del catalogo desde flujo normal', 'admin', true, true, ['private']),
  capability('catalog.loan.create', 'iniciar prestamo de un item disponible', 'write', true, false, ['private']),
  capability('catalog.loan.list', 'ver prestamos propios o prestamos visibles', 'read_only', true),
  capability('storage.search', 'buscar entradas de Storage visibles por texto, tag, tipo o extension', 'read_only', true),
  capability('storage.category.list', 'listar categorias de Storage visibles', 'read_only', true),
  capability('storage.upload.start', 'subir contenido a Storage con permisos existentes', 'write', true, false, ['private']),
  capability('storage.entry.detail', 'consultar detalle de una entrada de Storage visible', 'read_only', true),
  capability('storage.entry.edit', 'editar metadatos de una entrada de Storage con permisos existentes', 'write', true, false, ['private']),
  capability('notice.list', 'consultar avisos activos', 'read_only', true),
  capability('notice.create', 'crear un aviso para destinos /news avisos', 'write', true, false, ['private']),
  capability('notice.archive', 'archivar avisos propios', 'write', true, false, ['private']),
  capability('group_purchase.list', 'consultar compras conjuntas abiertas', 'read_only', true),
  capability('group_purchase.detail', 'consultar detalle de una compra conjunta', 'read_only', true),
  capability('group_purchase.join', 'participar en una compra conjunta', 'write', true, false, ['private']),
  capability('group_purchase.create', 'crear una compra conjunta por flujo normal', 'write', true, false, ['private']),
  capability('lfg.list', 'consultar busquedas LFG activas', 'read_only', true),
  capability('lfg.create', 'crear o editar una busqueda LFG', 'write', true, false, ['private']),
  capability('news.status', 'consultar estado basico no administrativo de noticias visibles', 'read_only', true),
  capability('clarify', 'pedir una aclaracion cuando falten datos', 'unknown', false),
  capability('unsupported', 'rechazar peticiones no soportadas', 'unknown', false),
];

export const llmCommandIntentSet = new Set<LlmCommandIntent>(llmCommandIntentValues);

export function findLlmCommandCapability(intent: string): LlmCommandCapability | undefined {
  return llmCommandCapabilities.find((capability) => capability.intent === intent);
}

export function listAllowedLlmCommandCapabilities(input: {
  isApproved: boolean;
  isAdmin: boolean;
  chatKind: TelegramChatContextKind;
  includeWrites?: boolean;
}): LlmCommandCapability[] {
  return llmCommandCapabilities.filter((capability) => {
    if (capability.requiresAdmin && !input.isAdmin) {
      return false;
    }
    if (capability.requiresApprovedMember && !input.isApproved) {
      return false;
    }
    if (!capability.allowedChatKinds.includes(input.chatKind)) {
      return false;
    }
    if (input.chatKind !== 'private' && capability.risk !== 'read_only' && !input.includeWrites) {
      return false;
    }
    return true;
  });
}

function capability(
  intent: LlmCommandIntent,
  description: string,
  risk: LlmCommandRisk,
  requiresApprovedMember: boolean,
  requiresAdmin = false,
  allowedChatKinds: TelegramChatContextKind[] = ['private', 'group', 'group-news'],
): LlmCommandCapability {
  return {
    intent,
    description,
    risk,
    requiresApprovedMember,
    requiresAdmin,
    allowedChatKinds,
  };
}
