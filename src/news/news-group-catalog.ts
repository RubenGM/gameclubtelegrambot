export interface NewsGroupRecord {
  chatId: number;
  isEnabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  enabledAt: string | null;
  disabledAt: string | null;
}

type CatalogLoanCategoryItemType = 'board-game' | 'book' | 'rpg-book';

export type NewsGroupCategoryKey =
  | 'events'
  | 'public-events'
  | 'avisos'
  | 'group-purchases'
  | 'lfg:players'
  | 'lfg:groups'
  | 'nuevos_miembros'
  | 'catalog-loans:board-game'
  | 'catalog-loans:book'
  | 'catalog-loans:rpg-book';

export type NewsGroupCatalogLocale = 'ca' | 'es' | 'en';

export interface NewsGroupCategoryDescriptor {
  key: NewsGroupCategoryKey;
  aliases: readonly string[];
  label: Record<NewsGroupCatalogLocale, string>;
  description: Record<NewsGroupCatalogLocale, string>;
  defaultSubscribed: boolean;
}

export const newsGroupCategories: readonly NewsGroupCategoryDescriptor[] = [
  {
    key: 'events',
    aliases: ['events', 'event', 'activitats', 'agenda', 'calendar'],
    label: {
      ca: 'events',
      es: 'events',
      en: 'events',
    },
    description: {
      ca: 'activitats i calendari del club',
      es: 'actividades y calendario del club',
      en: 'club activities and calendar',
    },
    defaultSubscribed: true,
  },
  {
    key: 'public-events',
    aliases: ['public-events', 'eventos-publicos', 'actividades-publicas', 'activitats-publiques', 'public'],
    label: {
      ca: 'public-events',
      es: 'public-events',
      en: 'public-events',
    },
    description: {
      ca: 'activitats públiques obertes a persones no sòcies',
      es: 'actividades públicas abiertas a personas no socias',
      en: 'public activities open to non-members',
    },
    defaultSubscribed: false,
  },
  {
    key: 'avisos',
    aliases: ['avisos', 'aviso', 'notices', 'notice', 'alerts', 'alertas'],
    label: {
      ca: 'avisos',
      es: 'avisos',
      en: 'notices',
    },
    description: {
      ca: 'avisos publicats pels socis del club',
      es: 'avisos publicados por los socios del club',
      en: 'notices published by club members',
    },
    defaultSubscribed: false,
  },
  {
    key: 'group-purchases',
    aliases: ['group-purchases', 'group purchases', 'compras', 'compras conjuntas', 'compres', 'compres conjuntes'],
    label: {
      ca: 'group-purchases',
      es: 'group-purchases',
      en: 'group-purchases',
    },
    description: {
      ca: 'compres conjuntes del club',
      es: 'compras conjuntas del club',
      en: 'club group purchases',
    },
    defaultSubscribed: true,
  },
  {
    key: 'lfg:players',
    aliases: ['lfg:players', 'lfg players', 'players', 'jugadors', 'jugador'],
    label: {
      ca: 'lfg:players',
      es: 'lfg:players',
      en: 'lfg:players',
    },
    description: {
      ca: 'jugadors buscant grup',
      es: 'jugadores buscando grupo',
      en: 'players looking for a group',
    },
    defaultSubscribed: false,
  },
  {
    key: 'lfg:groups',
    aliases: ['lfg:groups', 'lfg groups', 'groups', 'grups', 'grup'],
    label: {
      ca: 'lfg:groups',
      es: 'lfg:groups',
      en: 'lfg:groups',
    },
    description: {
      ca: 'grups buscant jugadors',
      es: 'grupos buscando jugadores',
      en: 'groups looking for players',
    },
    defaultSubscribed: false,
  },
  {
    key: 'nuevos_miembros',
    aliases: ['nuevos_miembros', 'new-members', 'socios', 'members'],
    label: {
      ca: 'nuevos_miembros',
      es: 'nuevos_miembros',
      en: 'nuevos_miembros',
    },
    description: {
      ca: 'altes web de nous socis',
      es: 'altas web de nuevos socios',
      en: 'new member web signups',
    },
    defaultSubscribed: false,
  },
  {
    key: 'catalog-loans:board-game',
    aliases: ['catalog-loans:board-game', 'loans board-game', 'board-game', 'board game', 'taulers'],
    label: {
      ca: 'catalog-loans:board-game',
      es: 'catalog-loans:board-game',
      en: 'catalog-loans:board-game',
    },
    description: {
      ca: 'préstecs i retorns de jocs de taula',
      es: 'préstamos y devoluciones de juegos de mesa',
      en: 'board game loans and returns',
    },
    defaultSubscribed: false,
  },
  {
    key: 'catalog-loans:book',
    aliases: ['catalog-loans:book', 'loans book', 'book', 'llibres', 'llibre'],
    label: {
      ca: 'catalog-loans:book',
      es: 'catalog-loans:book',
      en: 'catalog-loans:book',
    },
    description: {
      ca: 'préstecs i retorns de llibres',
      es: 'préstamos y devoluciones de libros',
      en: 'book loans and returns',
    },
    defaultSubscribed: false,
  },
  {
    key: 'catalog-loans:rpg-book',
    aliases: ['catalog-loans:rpg-book', 'loans rpg-book', 'rpg-book', 'rpg', 'llibres de rol', 'llibre de rol'],
    label: {
      ca: 'catalog-loans:rpg-book',
      es: 'catalog-loans:rpg-book',
      en: 'catalog-loans:rpg-book',
    },
    description: {
      ca: 'préstecs i retorns de llibres de rol',
      es: 'préstamos y devoluciones de libros de rol',
      en: 'RPG book loans and returns',
    },
    defaultSubscribed: false,
  },
] as const;

const newsGroupCategoryAliasMap = new Map<string, NewsGroupCategoryDescriptor>();
for (const category of newsGroupCategories) {
  newsGroupCategoryAliasMap.set(category.key, category);
  for (const alias of category.aliases) {
    newsGroupCategoryAliasMap.set(alias.trim().toLowerCase(), category);
  }
}

export const newsGroupCategoryDefaults = newsGroupCategories.filter((category) => category.defaultSubscribed);
export const lfgPlayerNewsCategory = 'lfg:players' as const;
export const lfgGroupNewsCategory = 'lfg:groups' as const;
export const eventsNewsGroupCategory = 'events' as const;
export const publicEventsNewsGroupCategory = 'public-events' as const;
export const noticesNewsGroupCategory = 'avisos' as const;
export const groupPurchaseNewsGroupCategory = 'group-purchases' as const;
export const newMembersNewsGroupCategory = 'nuevos_miembros' as const;

export const catalogLoanNewsCategoryByItemType: Partial<Record<CatalogLoanCategoryItemType, NewsGroupCategoryKey>> = {
  'board-game': 'catalog-loans:board-game',
  book: 'catalog-loans:book',
  'rpg-book': 'catalog-loans:rpg-book',
};

export function listNewsGroupCategories(): readonly NewsGroupCategoryDescriptor[] {
  return newsGroupCategories;
}

export function resolveNewsGroupCategory(categoryKey: string): NewsGroupCategoryDescriptor | undefined {
  return newsGroupCategoryAliasMap.get(categoryKey.trim().toLowerCase());
}

export function normalizeNewsGroupCategoryKey(categoryKey: string): string {
  const resolved = resolveNewsGroupCategory(categoryKey);
  return resolved ? resolved.key : categoryKey.trim().toLowerCase();
}

export function isValidNewsGroupCategoryKey(categoryKey: string): categoryKey is NewsGroupCategoryKey {
  return resolveNewsGroupCategory(categoryKey) !== undefined;
}

export function newsGroupCategoryLines(
  categories: readonly NewsGroupCategoryDescriptor[],
  language: NewsGroupCatalogLocale,
): string[] {
  return categories.map((category) => `- ${newsGroupCategoryLabel(category, language)}: ${newsGroupCategoryDescription(category, language)}`);
}

export function newsGroupCategoryLabelList(
  categories: readonly NewsGroupCategoryDescriptor[],
  language: NewsGroupCatalogLocale,
): string {
  return categories.map((category) => newsGroupCategoryLabel(category, language)).join(', ');
}

export function newsGroupCategoryLabel(category: NewsGroupCategoryDescriptor, language: NewsGroupCatalogLocale): string {
  return category.label[language] ?? category.label.en;
}

export function newsGroupCategoryDescription(category: NewsGroupCategoryDescriptor, language: NewsGroupCatalogLocale): string {
  return category.description[language] ?? category.description.en;
}

export interface NewsGroupSubscriptionRecord {
  chatId: number;
  messageThreadId: number | null;
  categoryKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewsGroupDeliveryTarget extends NewsGroupRecord {
  messageThreadId: number | null;
}

export interface NewsGroupRepository {
  findGroupByChatId(chatId: number): Promise<NewsGroupRecord | null>;
  listGroups(input?: { includeDisabled?: boolean }): Promise<NewsGroupRecord[]>;
  upsertGroup(input: {
    chatId: number;
    isEnabled: boolean;
    metadata?: Record<string, unknown> | null;
  }): Promise<NewsGroupRecord>;
  listSubscriptionsByChatId(chatId: number, input?: { messageThreadId?: number | null }): Promise<NewsGroupSubscriptionRecord[]>;
  upsertSubscription(input: { chatId: number; categoryKey: string; messageThreadId?: number | null }): Promise<NewsGroupSubscriptionRecord>;
  deleteSubscription(input: { chatId: number; categoryKey: string; messageThreadId?: number | null }): Promise<boolean>;
  listSubscribedGroupsByCategory(categoryKey: string): Promise<NewsGroupDeliveryTarget[]>;
  isNewsEnabledGroup(chatId: number): Promise<boolean>;
}

export async function upsertNewsGroup({
  repository,
  chatId,
  isEnabled,
  metadata,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  isEnabled: boolean;
  metadata?: Record<string, unknown> | null;
}): Promise<NewsGroupRecord> {
  return repository.upsertGroup({
    chatId: normalizeChatId(chatId),
    isEnabled,
    ...(metadata !== undefined ? { metadata: normalizeMetadata(metadata) } : {}),
  });
}

export async function subscribeNewsGroup({
  repository,
  chatId,
  categoryKey,
  messageThreadId,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  categoryKey: string;
  messageThreadId?: number | null;
}): Promise<NewsGroupSubscriptionRecord> {
  return repository.upsertSubscription({
    chatId: normalizeChatId(chatId),
    categoryKey: normalizeCategoryKey(categoryKey),
    messageThreadId: normalizeMessageThreadId(messageThreadId),
  });
}

export async function unsubscribeNewsGroup({
  repository,
  chatId,
  categoryKey,
  messageThreadId,
}: {
  repository: NewsGroupRepository;
  chatId: number;
  categoryKey: string;
  messageThreadId?: number | null;
}): Promise<boolean> {
  return repository.deleteSubscription({
    chatId: normalizeChatId(chatId),
    categoryKey: normalizeCategoryKey(categoryKey),
    messageThreadId: normalizeMessageThreadId(messageThreadId),
  });
}

export async function listNewsGroupsByCategory({
  repository,
  categoryKey,
}: {
  repository: NewsGroupRepository;
  categoryKey: string;
}): Promise<NewsGroupRecord[]> {
  return repository.listSubscribedGroupsByCategory(normalizeCategoryKey(categoryKey));
}

function normalizeChatId(chatId: number): number {
  if (!Number.isInteger(chatId) || chatId === 0) {
    throw new Error('El chat id del grup ha de ser un enter valid');
  }

  return chatId;
}

function normalizeCategoryKey(categoryKey: string): string {
  const normalized = categoryKey.trim();
  if (!normalized) {
    throw new Error('La clau de categoria és obligatòria');
  }

  return normalized;
}

export function normalizeMessageThreadId(messageThreadId: number | null | undefined): number | null {
  if (messageThreadId === null || messageThreadId === undefined || messageThreadId === 0) {
    return null;
  }

  if (!Number.isInteger(messageThreadId) || messageThreadId < 0) {
    throw new Error('El message_thread_id ha de ser un enter positiu');
  }

  return messageThreadId;
}

function normalizeMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  return metadata;
}
