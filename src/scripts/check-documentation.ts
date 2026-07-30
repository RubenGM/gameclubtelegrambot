import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docsRoot = resolve(projectRoot, 'docs');

const failures: string[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function checkLocalLinks(filePath: string): Promise<void> {
  const source = await readFile(filePath, 'utf8');
  for (const match of source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    const rawTarget = match[1]?.trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:https?:|mailto:|tg:|#)/.test(rawTarget)) {
      continue;
    }

    const withoutAnchor = rawTarget.split('#', 1)[0];
    if (!withoutAnchor) {
      continue;
    }

    const target = resolve(dirname(filePath), decodeURIComponent(withoutAnchor));
    if (!(await exists(target))) {
      failures.push(`${relative(filePath)} enlaza a una ruta inexistente: ${rawTarget}`);
    }
  }
}

function relative(path: string): string {
  return path.startsWith(`${projectRoot}/`) ? path.slice(projectRoot.length + 1) : path;
}

const topLevelDocs = (await readdir(docsRoot))
  .filter((name) => name.endsWith('.md'))
  .sort();

for (const file of [resolve(projectRoot, 'README.md'), ...topLevelDocs.map((name) => resolve(docsRoot, name))]) {
  await checkLocalLinks(file);
}

const docsIndex = await readFile(resolve(docsRoot, 'README.md'), 'utf8');
for (const name of topLevelDocs) {
  if (name !== 'README.md' && !docsIndex.includes(`(${name})`)) {
    failures.push(`docs/README.md no incluye docs/${name}`);
  }
}

const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const knownScripts = new Set(Object.keys(packageJson.scripts ?? {}));
for (const file of [resolve(projectRoot, 'README.md'), ...topLevelDocs.map((name) => resolve(docsRoot, name))]) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g)) {
    const script = match[1];
    if (script && !knownScripts.has(script)) {
      failures.push(`${relative(file)} menciona un script npm inexistente: ${script}`);
    }
  }
}

const featureStatus = await readFile(resolve(docsRoot, 'feature-status.md'), 'utf8');
for (const heading of [
  '## LFG / buscar grupo',
  '## Feedback web y Telegram',
  '## Impresión',
  '## Generación de imágenes',
  '## Tests relevantes por área',
]) {
  if (!featureStatus.includes(heading)) {
    failures.push(`docs/feature-status.md no contiene la sección obligatoria: ${heading}`);
  }
}

for (const match of featureStatus.matchAll(/`(src\/[^`]*\.test\.ts)`/g)) {
  const testPath = match[1];
  if (testPath && !testPath.includes('*') && !(await exists(resolve(projectRoot, testPath)))) {
    failures.push(`docs/feature-status.md menciona un test inexistente: ${testPath}`);
  }
}

if (!/## Resumen ejecutivo\s+```text\s+\+[-+]+\+\s+\| Feature/u.test(featureStatus)) {
  failures.push('docs/feature-status.md no mantiene el resumen ejecutivo como tabla de texto ancho fijo');
}

if (failures.length > 0) {
  process.stderr.write(`Documentación inconsistente:\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Documentación coherente: ${topLevelDocs.length} guías indexadas, enlaces locales, scripts y tests verificados.\n`,
  );
}
