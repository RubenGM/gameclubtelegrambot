import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CatalogItemType } from './catalog-model.js';

const execFileAsync = promisify(execFile);

export interface WikipediaBoardGameCatalogDraft {
  familyId: number | null;
  groupId: number | null;
  itemType: CatalogItemType;
  displayName: string;
  originalName: string | null;
  description: string | null;
  language: string | null;
  publisher: string | null;
  publicationYear: number | null;
  playerCountMin: number | null;
  playerCountMax: number | null;
  recommendedAge: number | null;
  playTimeMinutes: number | null;
  externalRefs: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface WikipediaBoardGameImportService {
  importByTitle(title: string): Promise<WikipediaBoardGameCatalogDraft | null>;
}

export function createWikipediaBoardGameImportService({
  scriptPath = './scripts/wikipedia-boardgame-catalog-import.sh',
  execImpl = execFileAsync,
}: {
  scriptPath?: string;
  execImpl?: typeof execFileAsync;
} = {}): WikipediaBoardGameImportService {
  return {
    async importByTitle(title: string) {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        return null;
      }

      try {
        const { stdout } = await execImpl('bash', [scriptPath, normalizedTitle], { maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout) as unknown;
        return isValidDraft(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}

function isValidDraft(value: unknown): value is WikipediaBoardGameCatalogDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const draft = value as Partial<WikipediaBoardGameCatalogDraft>;
  return typeof draft.displayName === 'string'
    && typeof draft.itemType === 'string'
    && draft.externalRefs !== undefined
    && draft.metadata !== undefined;
}
