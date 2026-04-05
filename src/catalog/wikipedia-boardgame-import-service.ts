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
  importByTitle(title: string): Promise<WikipediaBoardGameImportResult>;
}

export type WikipediaBoardGameImportResult =
  | {
      ok: true;
      draft: WikipediaBoardGameCatalogDraft;
    }
  | {
      ok: false;
      error: {
        type: WikipediaBoardGameImportErrorType;
        message: string;
      };
    };

export type WikipediaBoardGameImportErrorType = 'bad-input' | 'connection' | 'invalid-response' | 'not-found' | 'unexpected';

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
        return { ok: false, error: { type: 'bad-input', message: 'Falta el nom del joc.' } };
      }

      try {
        const { stdout } = await execImpl('bash', [scriptPath, normalizedTitle], { maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout) as unknown;
        return parseImportResult(parsed);
      } catch (error) {
        return {
          ok: false,
          error: {
            type: 'connection',
            message: error instanceof Error ? error.message : 'No s ha pogut connectar amb el servei d importacio.',
          },
        };
      }
    },
  };
}

function parseImportResult(value: unknown): WikipediaBoardGameImportResult {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: { type: 'invalid-response', message: 'La resposta del servei no és vàlida.' } };
  }

  const payload = value as {
    ok?: unknown;
    draft?: unknown;
    error?: { type?: unknown; message?: unknown };
  };

  if (payload.ok === false) {
    return {
      ok: false,
      error: {
        type: asImportErrorType(payload.error?.type),
        message: typeof payload.error?.message === 'string' ? payload.error.message : 'No s ha trobat cap coincidencia a Wikipedia.',
      },
    };
  }

  if (payload.ok === true && isValidDraft(payload.draft)) {
    return { ok: true, draft: normalizeDraft(payload.draft) };
  }

  if (isValidDraft(value)) {
    return { ok: true, draft: normalizeDraft(value) };
  }

  return { ok: false, error: { type: 'invalid-response', message: 'La resposta del servei no és vàlida.' } };
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

function normalizeDraft(draft: WikipediaBoardGameCatalogDraft): WikipediaBoardGameCatalogDraft {
  return {
    ...draft,
    publicationYear: normalizeOptionalInteger(draft.publicationYear),
    playerCountMin: normalizeOptionalInteger(draft.playerCountMin),
    playerCountMax: normalizeOptionalInteger(draft.playerCountMax),
    recommendedAge: normalizeOptionalInteger(draft.recommendedAge),
    playTimeMinutes: normalizeOptionalInteger(draft.playTimeMinutes),
  };
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+/);
    if (match) {
      return Number(match[0]);
    }
  }

  return null;
}

function asImportErrorType(value: unknown): WikipediaBoardGameImportErrorType {
  if (value === 'bad-input' || value === 'connection' || value === 'invalid-response' || value === 'not-found' || value === 'unexpected') {
    return value;
  }

  return 'unexpected';
}
