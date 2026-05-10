import { spawn } from 'node:child_process';

export type CatalogDescriptionTranslatorInput = {
  description: string;
  model: string;
  targetLanguage: 'es';
};

export type CatalogDescriptionTranslator = (input: CatalogDescriptionTranslatorInput) => Promise<string>;

export type CatalogDescriptionTranslatorOptions = {
  deeplApiKey?: string;
  deeplApiUrl?: string;
  deeplTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  opencodeBin: string;
};

const defaultDeepLFreeApiUrl = 'https://api-free.deepl.com/v2/translate';
const defaultDeepLProApiUrl = 'https://api.deepl.com/v2/translate';
const defaultDeepLTimeoutMs = 3000;

export function createCatalogDescriptionTranslator({
  deeplApiKey,
  deeplApiUrl,
  deeplTimeoutMs = defaultDeepLTimeoutMs,
  fetchImpl = fetch,
  opencodeBin,
}: CatalogDescriptionTranslatorOptions): CatalogDescriptionTranslator {
  return async (input) => {
    const normalizedDeepLApiKey = deeplApiKey?.trim();
    if (normalizedDeepLApiKey) {
      try {
        return await translateDescriptionWithDeepL({
          description: input.description,
          targetLanguage: input.targetLanguage,
          apiKey: normalizedDeepLApiKey,
          apiUrl: deeplApiUrl?.trim() || resolveDefaultDeepLApiUrl(normalizedDeepLApiKey),
          timeoutMs: deeplTimeoutMs,
          fetchImpl,
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'catalog.description.translation.deepl.failed',
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        }));
      }
    }

    return translateDescriptionWithOpencode({
      description: input.description,
      model: input.model,
      targetLanguage: input.targetLanguage,
      opencodeBin,
    });
  };
}

export async function translateDescriptionWithDeepL({
  description,
  targetLanguage,
  apiKey,
  apiUrl,
  timeoutMs = defaultDeepLTimeoutMs,
  fetchImpl = fetch,
}: {
  description: string;
  targetLanguage: 'es';
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const startedAt = Date.now();
  try {
    const body = new URLSearchParams({
      text: decodeCommonHtmlEntities(description),
      target_lang: targetLanguage.toUpperCase(),
      preserve_formatting: '1',
    });
    const response = await fetchImpl(apiUrl?.trim() || resolveDefaultDeepLApiUrl(apiKey), {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`DeepL translation failed with status ${response.status}`);
    }

    const payload = await response.json() as { translations?: Array<{ text?: unknown }> };
    const translated = payload.translations?.[0]?.text;
    if (typeof translated !== 'string' || translated.trim().length === 0) {
      throw new Error('DeepL did not return a translated text');
    }

    console.info(JSON.stringify({
      event: 'catalog.description.translation.deepl.completed',
      elapsedMs: Date.now() - startedAt,
      originalLength: description.length,
      translatedLength: translated.length,
    }));
    return translated;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`DeepL translation timed out after ${timeoutMs} ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function translateDescriptionWithOpencode({
  description,
  model,
  opencodeBin,
}: CatalogDescriptionTranslatorInput & {
  opencodeBin: string;
}): Promise<string> {
  const prompt = [
    'Traduce al castellano la siguiente descripcion de un juego de mesa.',
    'Devuelve solo la descripcion traducida, sin explicaciones, sin encabezados y sin markdown.',
    'Conserva los parrafos y elimina entidades HTML si aparecen.',
    '',
    description,
  ].join('\n');

  return runOpencodeTextPromptCapture({
    prompt,
    model,
    opencodeBin,
  });
}

function runOpencodeTextPromptCapture({
  prompt,
  model,
  opencodeBin,
}: {
  prompt: string;
  model: string;
  opencodeBin: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opencodeBin, ['run', prompt, '--model', model], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve((stdout.trim() || stderr.trim()).trim());
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `opencode exited with code ${code ?? 1}`));
    });
  });
}

function resolveDefaultDeepLApiUrl(apiKey: string): string {
  return apiKey.endsWith(':fx') ? defaultDeepLFreeApiUrl : defaultDeepLProApiUrl;
}

function decodeCommonHtmlEntities(value: string): string {
  return value
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}
