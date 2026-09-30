import { execFileSync, spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoryFor, selectTests, type SourceFile } from './selection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);

async function readSources(directory: string): Promise<SourceFile[]> {
  const result: SourceFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await readSources(file));
    else if (file.endsWith('.ts')) result.push({ path: file, content: await readFile(file, 'utf8') });
  }
  return result;
}

function gitFiles(args: string[]): string[] {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let since = 'HEAD';
  let all = false;
  let dryRun = false;
  let list = false;
  let kind: 'all' | 'unit' | 'integration' = 'all';
  const categories: string[] = [];
  const explicitFiles: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') all = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--list') list = true;
    else if (arg === '--unit') kind = 'unit';
    else if (arg === '--integration') kind = 'integration';
    else if (arg === '--since' || arg === '--category' || arg === '--file') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Falta valor para ${arg}`);
      if (arg === '--since') since = value;
      else if (arg === '--category') categories.push(...value.split(','));
      else {
        const relative = path.relative(root, path.resolve(root, value)).split(path.sep).join('/');
        if (relative.startsWith('../')) throw new Error('El archivo debe estar dentro del repositorio');
        explicitFiles.push(relative);
      }
    } else if (arg === '--help') {
      console.log('Uso: npm test -- [--since REF] [--category NOMBRE] [--file RUTA] [--unit|--integration] [--all] [--list] [--dry-run]');
      return;
    } else throw new Error(`Opción desconocida: ${arg}`);
  }
  if (all && (categories.length || explicitFiles.length)) throw new Error('--all no admite --category o --file');
  if (categories.length && explicitFiles.length) throw new Error('Usa --category o --file, sin mezclarlos');
  const sources = await readSources('src');
  const tests = sources.map((file) => file.path).filter((file) => file.endsWith('.test.ts')).sort();
  const categoryNames = [...new Set(tests.map(categoryFor))].filter((value): value is string => value !== null).sort();
  for (const category of categories) if (!categoryNames.includes(category)) throw new Error(`Categoría desconocida: ${category}`);
  if (list) {
    for (const category of categoryNames) {
      const members = tests.filter((file) => categoryFor(file) === category);
      console.log(`${category}: ${members.length} archivos (${members.filter((file) => file.endsWith('.integration.test.ts')).length} integración)`);
    }
    return;
  }
  let selected: string[];
  let reasons: string[];
  if (all) { selected = tests; reasons = ['Suite completa solicitada.']; }
  else if (categories.length) {
    selected = tests.filter((file) => categories.includes(categoryFor(file) ?? ''));
    reasons = [`Categorías explícitas: ${categories.join(', ')}`];
  } else {
    // --no-renames retains both paths so deletions and renames participate in selection.
    const changed = explicitFiles.length ? explicitFiles : [...new Set([
      ...gitFiles(['diff', '--no-renames', '--name-only', '-z', since, '--']),
      ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
    ])];
    console.log(`Archivos considerados: ${changed.length}`);
    ({ tests: selected, reasons } = selectTests(sources, changed));
  }
  selected = selected.filter((file) => kind === 'all' || file.endsWith('.integration.test.ts') === (kind === 'integration'));
  reasons.forEach((reason) => console.log(reason));
  console.log(`Pruebas seleccionadas: ${selected.length}/${tests.length} archivos (${kind}).`);
  if (!selected.length) { console.log('No hay pruebas afectadas.'); return; }
  if (dryRun) { selected.forEach((file) => console.log(file)); return; }
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...selected], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
