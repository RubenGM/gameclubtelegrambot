import path from 'node:path';
import ts from 'typescript';

export interface SourceFile { path: string; content: string }
export interface Selection { tests: string[]; reasons: string[] }

const directories: Record<string, string> = {
  membership: 'access', authorization: 'access', security: 'access', audit: 'runtime',
  catalog: 'catalog', schedule: 'agenda', tables: 'tables', equipment: 'equipment',
  'venue-events': 'venue-events', 'group-purchases': 'purchases', storage: 'storage',
  notices: 'notices', news: 'news', lfg: 'lfg', 'role-games': 'role', notion: 'role',
  printing: 'printing', 'image-generation': 'images', 'google-calendar': 'google-calendar',
  http: 'web', config: 'runtime', bootstrap: 'runtime', infrastructure: 'runtime',
  operations: 'operations', tui: 'operations', tray: 'operations', scripts: 'operations', test: 'runtime',
};

export function categoryFor(file: string): string | null {
  const parts = file.split('/');
  if (file.startsWith('src/scripts/testing/')) return 'testing';
  if (file.startsWith('src/catalog/catalog-loan-')) return 'loans';
  if (parts[0] !== 'src') return null;
  if (parts[1] !== 'telegram') return directories[parts[1] ?? ''] ?? (parts.length === 2 ? 'runtime' : null);
  const name = parts[2] ?? '';
  const rules: Array<[RegExp, string]> = [
    [/^(llm-|admin-ai-|i18n-llm|i18n-admin-ai)/, 'ai'],
    [/^(image-generation-|i18n-image-generation)/, 'images'],
    [/^(catalog-loan-|i18n-catalog-loan)/, 'loans'],
    [/^(catalog-|i18n-catalog)/, 'catalog'],
    [/^(schedule-|calendar-|today-at-club-|promotion-destination-|i18n-schedule)/, 'agenda'],
    [/^(role-game-|i18n-role)/, 'role'],
    [/^(storage-|i18n-storage)/, 'storage'],
    [/^(print-|printer-|i18n-print)/, 'printing'],
    [/^(group-purchase-|i18n-group-purchase)/, 'purchases'],
    [/^(google-calendar-|i18n-google-calendar)/, 'google-calendar'],
    [/^(venue-event-|i18n-venue-event)/, 'venue-events'],
    [/^(table-|i18n-table)/, 'tables'], [/^(equipment-|i18n-equipment)/, 'equipment'],
    [/^(notice-|i18n-notice)/, 'notices'], [/^(news-|i18n-news)/, 'news'],
    [/^(lfg-|i18n-lfg)/, 'lfg'], [/^(feedback-|i18n-feedback)/, 'feedback'],
  ];
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? 'runtime';
}

function globalChange(file: string): boolean {
  return /^(package(?:-lock)?\.json|tsconfig[^/]*\.json|\.npmrc)$/.test(file)
    || file.startsWith('drizzle/') || file.startsWith('src/infrastructure/database/')
    || file.startsWith('src/scripts/testing/') || file.startsWith('.github/workflows/');
}

export function selectTests(files: SourceFile[], changed: string[]): Selection {
  const tests = files.map((file) => file.path).filter((file) => file.endsWith('.test.ts')).sort();
  const reasons: string[] = [];
  const reverse = new Map<string, Set<string>>();
  for (const file of files) {
    // TypeScript's parser handles static imports, re-exports and literal dynamic imports.
    for (const imported of ts.preProcessFile(file.content, true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      let dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), imported.fileName));
      dependency = dependency.replace(/\.(?:m?js|cjs)$/, '.ts');
      if (!path.posix.extname(dependency)) dependency += '.ts';
      const dependents = reverse.get(dependency) ?? new Set<string>();
      dependents.add(file.path);
      reverse.set(dependency, dependents);
    }
  }
  const affected = new Set<string>();
  const categories = new Set<string>();
  for (const file of changed) {
    if (file.endsWith('.test.ts')) { affected.add(file); continue; }
    if (globalChange(file)) return { tests, reasons: [`Cambio transversal: ${file}`] };
    if (/\.md$/.test(file) || /^(docs\/|improvements\/|\.agents\/)/.test(file)) continue;
    const category = categoryFor(file);
    if (category) {
      categories.add(category);
      affected.add(file);
    } else if (/^(scripts\/|deploy\/|config\/|startup\.sh$|docker-compose|compose\.)/.test(file)) {
      categories.add('operations');
      categories.add('runtime');
      if (/codex|opencode/.test(file)) ['ai', 'images', 'catalog'].forEach((value) => categories.add(value));
      if (/local-bot-api/.test(file)) ['printing', 'images', 'catalog'].forEach((value) => categories.add(value));
    } else {
      return { tests, reasons: [`Archivo sin regla de impacto: ${file}`] };
    }
  }
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++) {
    for (const dependent of reverse.get(queue[index]!) ?? []) {
      if (!affected.has(dependent)) { affected.add(dependent); queue.push(dependent); }
    }
  }
  if (categories.size) reasons.push(`Categorías modificadas: ${[...categories].sort().join(', ')}`);
  reasons.push('Incluye consumidores transitivos por imports y pruebas modificadas.');
  return { tests: tests.filter((file) => affected.has(file) || categories.has(categoryFor(file) ?? '')), reasons };
}
