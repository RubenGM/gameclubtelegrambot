import type { CatalogLookupCandidate } from '../catalog/catalog-lookup-service.js';
import { createTelegramI18n } from './i18n.js';

export function parseOptionalPositiveInteger(text: string, language: 'ca' | 'es' | 'en' = 'ca'): number | null | Error {
  if (text === createTelegramI18n(language).catalogAdmin.skipOptional) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return new Error('invalid-number');
  }
  return value;
}

export function parseOptionalNonNegativeInteger(text: string, language: 'ca' | 'es' | 'en' = 'ca'): number | null | Error {
  if (text === createTelegramI18n(language).catalogAdmin.skipOptional) {
    return null;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    return new Error('invalid-number');
  }
  return value;
}

export function parseOptionalJsonObject(text: string, language: 'ca' | 'es' | 'en' = 'ca'): Record<string, unknown> | null | Error {
  if (text === createTelegramI18n(language).catalogAdmin.skipOptional) {
    return null;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return new Error('invalid-json-object');
    }
    return value as Record<string, unknown>;
  } catch {
    return new Error('invalid-json-object');
  }
}

export function asLookupCandidate(value: unknown): CatalogLookupCandidate {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid lookup candidate');
  }
  return value as CatalogLookupCandidate;
}

export function asLookupCandidates(value: unknown): CatalogLookupCandidate[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') as CatalogLookupCandidate[] : [];
}

export function parseLookupCandidateInput(text: string, value: unknown): CatalogLookupCandidate | Error {
  const candidates = asLookupCandidates(value);
  return candidates.find((candidate) => candidate.title === text) ?? new Error('invalid-lookup-candidate');
}

export function parseItemId(callbackData: string, prefix: string): number {
  const value = Number(callbackData.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('No s ha pogut identificar l item seleccionat.');
  }
  return value;
}

export function parseWikipediaTitleFromUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!url.hostname.endsWith('wikipedia.org')) {
      return null;
    }

    if (url.pathname.startsWith('/wiki/')) {
      const encodedTitle = url.pathname.slice('/wiki/'.length);
      return decodeURIComponent(encodedTitle).replace(/_/g, ' ').trim() || null;
    }

    const title = url.searchParams.get('title');
    return title ? decodeURIComponent(title).replace(/_/g, ' ').trim() || null : null;
  } catch {
    return null;
  }
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}
