import type { AppMetadataSessionStorage } from '../telegram/conversation-session-store.js';

export interface WelcomeMessageTemplate {
  id: string;
  templateText: string;
  templateHtml?: string | null;
  animationFileId?: string | null;
  targetTelegramUserId?: number | null;
  isEnabled: boolean;
  sortOrder: number;
}

export interface WelcomeTemplateStore {
  listTemplates(): Promise<WelcomeMessageTemplate[]>;
  saveTemplate(input: Omit<WelcomeMessageTemplate, 'id'> & { id?: string }): Promise<WelcomeMessageTemplate>;
  deleteTemplate(id: string): Promise<boolean>;
  pickTemplate(input: {
    telegramUserId: number;
    excludeTemplateId?: string | null;
    random?: () => number;
  }): Promise<WelcomeMessageTemplate | null>;
}

const welcomeTemplatesKey = 'telegram.welcome_templates';

export function createAppMetadataWelcomeTemplateStore({
  storage,
}: {
  storage: AppMetadataSessionStorage;
}): WelcomeTemplateStore {
  return {
    async listTemplates() {
      return loadTemplates(storage);
    },
    async saveTemplate(input) {
      const templates = await loadTemplates(storage);
      const id = input.id?.trim() || createWelcomeTemplateId();
      const next: WelcomeMessageTemplate = normalizeTemplate({ ...input, id });
      const index = templates.findIndex((template) => template.id === id);
      const nextTemplates = index >= 0
        ? templates.map((template) => (template.id === id ? next : template))
        : [...templates, next];

      await saveTemplates(storage, nextTemplates);
      return next;
    },
    async deleteTemplate(id) {
      const templates = await loadTemplates(storage);
      const nextTemplates = templates.filter((template) => template.id !== id);
      if (nextTemplates.length === templates.length) {
        return false;
      }
      await saveTemplates(storage, nextTemplates);
      return true;
    },
    async pickTemplate({ telegramUserId, excludeTemplateId, random = Math.random }) {
      const templates = (await loadTemplates(storage))
        .filter((template) => template.isEnabled)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
      const targeted = templates.filter((template) => template.targetTelegramUserId === telegramUserId);
      const candidates = targeted.length > 0 ? targeted : templates.filter((template) => template.targetTelegramUserId == null);
      if (candidates.length === 0) {
        return null;
      }
      const eligibleCandidates = candidates.length > 1 && excludeTemplateId
        ? candidates.filter((template) => template.id !== excludeTemplateId)
        : candidates;
      const pool = eligibleCandidates.length > 0 ? eligibleCandidates : candidates;
      return pool[Math.floor(random() * pool.length) % pool.length] ?? pool[0] ?? null;
    },
  };
}

export function renderWelcomeTemplate(templateText: string, username: string): string {
  return templateText.replaceAll('$USERNAME', username);
}

export function renderWelcomeTemplateHtml(template: WelcomeMessageTemplate, username: string): string {
  const source = template.templateHtml ?? escapeHtml(template.templateText);
  return source.replaceAll('$USERNAME', escapeHtml(username));
}

function normalizeTemplate(input: WelcomeMessageTemplate): WelcomeMessageTemplate {
  const templateText = input.templateText.trim();
  if (!templateText) {
    throw new Error('La plantilla de bienvenida no puede estar vacia.');
  }

  return {
    id: input.id.trim(),
    templateText,
    templateHtml: normalizeOptionalString(input.templateHtml),
    animationFileId: normalizeOptionalString(input.animationFileId),
    targetTelegramUserId: normalizeOptionalNumber(input.targetTelegramUserId),
    isEnabled: Boolean(input.isEnabled),
    sortOrder: Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : 0,
  };
}

async function loadTemplates(storage: AppMetadataSessionStorage): Promise<WelcomeMessageTemplate[]> {
  const raw = await storage.get(welcomeTemplatesKey);
  if (!raw) {
    return [];
  }

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) =>
      normalizeTemplate({
        id: String(item.id ?? createWelcomeTemplateId()),
        templateText: String(item.templateText ?? ''),
        templateHtml: normalizeOptionalString(item.templateHtml),
        animationFileId: normalizeOptionalString(item.animationFileId),
        targetTelegramUserId: normalizeOptionalNumber(item.targetTelegramUserId),
        isEnabled: item.isEnabled !== false,
        sortOrder: normalizeOptionalNumber(item.sortOrder) ?? 0,
      }),
    )
    .filter((template) => template.templateText.length > 0);
}

async function saveTemplates(storage: AppMetadataSessionStorage, templates: WelcomeMessageTemplate[]): Promise<void> {
  await storage.set(welcomeTemplatesKey, JSON.stringify(templates.map(normalizeTemplate)));
}

function createWelcomeTemplateId(): string {
  return `welcome_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
