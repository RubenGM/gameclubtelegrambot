import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { buildCodexPromptArgs, type CodexPromptInput } from './codex-prompt.js';

export interface CodexImageQueryArgs {
  imagePath: string;
  question: string;
  model: string;
  codexBin: string;
  reasoningEffort: string;
  dryRun: boolean;
}

export const defaultCodexVisionModel = 'gpt-5.4-mini';

const usage = `Usage:
  npm run codex:image -- --image <path> --question <text> [--model <model>]

Example:
  npm run codex:image -- --image ./cover.jpg --question "Devuelve solo el nombre completo del juego de mesa de la caratula."

Options:
  --image PATH          Image file to attach to Codex.
  --question TEXT       Question to ask about the image.
  --model MODEL         Codex model id. Default: ${defaultCodexVisionModel}.
  --codex-bin PATH      Codex wrapper. Default: ./scripts/codex-cawa.sh.
  --reasoning EFFORT    Codex reasoning effort. Default: low.
  --dry-run             Print the resolved Codex command without running it.
  --help                Show this help.
`;

export function parseCodexImageQueryArgs(argv: string[]): CodexImageQueryArgs {
  let imagePath = '';
  let question = '';
  let model = defaultCodexVisionModel;
  let codexBin = './scripts/codex-cawa.sh';
  let reasoningEffort = 'low';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index] ?? '';
    if (current === '--help' || current === '-h') throw new HelpRequested();
    if (current === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (['--image', '--question', '--model', '--codex-bin', '--reasoning'].includes(current)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${current} requires a value`);
      if (current === '--image') imagePath = value;
      else if (current === '--question') question = value;
      else if (current === '--model') model = value;
      else if (current === '--codex-bin') codexBin = value;
      else reasoningEffort = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${current}`);
  }
  if (!imagePath.trim()) throw new Error('--image is required');
  if (!question.trim()) throw new Error('--question is required');
  return { imagePath, question: question.trim(), model: model.trim(), codexBin: codexBin.trim(), reasoningEffort: reasoningEffort.trim(), dryRun };
}

export function buildVisionPrompt(question: string): string {
  return [
    'Responde a la pregunta usando solo la informacion visible en la imagen adjunta.',
    'Si no puedes identificarlo con confianza, dilo claramente y devuelve la mejor lectura posible.',
    'No busques datos completos ni metadatos externos: esa parte la hara el flujo de BoardGameGeek.',
    '',
    `Pregunta: ${question}`,
  ].join('\n');
}

export function buildCodexImageQueryArgs(args: Pick<CodexImageQueryArgs, 'imagePath' | 'model' | 'reasoningEffort'>): string[] {
  return buildCodexPromptArgs({ model: args.model, reasoningEffort: args.reasoningEffort, imagePath: args.imagePath });
}

export async function runCodexImageQuery(args: CodexImageQueryArgs): Promise<number> {
  await access(args.imagePath);
  const codexArgs = buildCodexImageQueryArgs(args);
  if (args.dryRun) {
    process.stdout.write(`${shellQuote([args.codexBin, ...codexArgs])}\n`);
    return 0;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(args.codexBin, codexArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
    child.stdin.end(buildVisionPrompt(args.question));
  });
}

export async function runCodexImageQueryCapture(args: Omit<CodexImageQueryArgs, 'dryRun'>): Promise<string> {
  const { runCodexPromptCapture } = await import('./codex-prompt.js');
  return runCodexPromptCapture({
    prompt: buildVisionPrompt(args.question),
    model: args.model,
    codexBin: args.codexBin,
    reasoningEffort: args.reasoningEffort,
    imagePath: args.imagePath,
  } satisfies CodexPromptInput);
}

export function getCodexImageQueryUsage(): string {
  return usage;
}

export class HelpRequested extends Error {}

function shellQuote(values: string[]): string {
  return values.map((value) => /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`).join(' ');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await runCodexImageQuery(parseCodexImageQueryArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(getCodexImageQueryUsage());
      process.exitCode = 0;
    } else if (error instanceof Error) {
      process.stderr.write(`${error.message}\n\n${getCodexImageQueryUsage()}`);
      process.exitCode = 1;
    } else throw error;
  }
}
