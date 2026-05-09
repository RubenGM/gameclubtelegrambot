import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

export interface OpencodeImageQueryArgs {
  imagePath: string;
  question: string;
  model: string;
  opencodeBin: string;
  dryRun: boolean;
}

export const defaultOpencodeVisionModel = 'openai/gpt-5.4-mini';

const usage = `Usage:
  npm run opencode:image -- --image <path> --question <text> [--model <provider/model>]

Example:
  npm run opencode:image -- --image ./cover.jpg --question "Devuelve solo el nombre completo del juego de mesa de la caratula."

Recommended models:
  openai/gpt-5.4-mini   Default for cover/title extraction. Supports vision detail low/high/auto.
  openai/gpt-5.4        Use when the image is hard to read or needs original-detail fidelity.
  openai/gpt-5.5        Stronger current option when available in OpenCode.

Notes:
  - Use clear, upright PNG/JPEG/WEBP/GIF images when possible.
  - For this workflow, ask only for the visible title/name. BoardGameGeek remains the metadata source.
  - OpenAI vision reference: https://developers.openai.com/api/docs/guides/images-vision

Options:
  --image PATH          Image file to attach to OpenCode.
  --question TEXT       Question to ask about the image.
  --model MODEL         OpenCode model id, usually provider/model. Default: ${defaultOpencodeVisionModel}.
  --opencode-bin PATH   OpenCode executable. Default: opencode.
  --dry-run             Print the resolved opencode command without running it.
  --help                Show this help.
`;

export function parseOpencodeImageQueryArgs(argv: string[]): OpencodeImageQueryArgs {
  let imagePath = '';
  let question = '';
  let model = defaultOpencodeVisionModel;
  let opencodeBin = 'opencode';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--help' || current === '-h') {
      throw new HelpRequested();
    }

    if (current === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (current === '--image' || current === '--question' || current === '--model' || current === '--opencode-bin') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${current} requires a value`);
      }

      if (current === '--image') {
        imagePath = value;
      } else if (current === '--question') {
        question = value;
      } else if (current === '--model') {
        model = value;
      } else {
        opencodeBin = value;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  if (!imagePath.trim()) {
    throw new Error('--image is required');
  }
  if (!question.trim()) {
    throw new Error('--question is required');
  }
  return {
    imagePath,
    question: question.trim(),
    model: model.trim(),
    opencodeBin: opencodeBin.trim() || 'opencode',
    dryRun,
  };
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

export function buildOpencodeRunArgs(args: Pick<OpencodeImageQueryArgs, 'imagePath' | 'question' | 'model'>): string[] {
  return [
    'run',
    buildVisionPrompt(args.question),
    '--model',
    args.model,
    '--file',
    args.imagePath,
  ];
}

export async function runOpencodeImageQuery(args: OpencodeImageQueryArgs): Promise<number> {
  await access(args.imagePath);

  const opencodeArgs = buildOpencodeRunArgs(args);
  if (args.dryRun) {
    process.stdout.write(`${shellQuote([args.opencodeBin, ...opencodeArgs])}\n`);
    return 0;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(args.opencodeBin, opencodeArgs, {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function runOpencodeImageQueryCapture(args: Omit<OpencodeImageQueryArgs, 'dryRun'>): Promise<string> {
  await access(args.imagePath);

  const opencodeArgs = buildOpencodeRunArgs(args);
  return new Promise((resolve, reject) => {
    const child = spawn(args.opencodeBin, opencodeArgs, {
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

export function getOpencodeImageQueryUsage(): string {
  return usage;
}

export class HelpRequested extends Error {
  constructor() {
    super('Help requested');
  }
}

function shellQuote(values: string[]): string {
  return values.map((value) => {
    if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
      return value;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
  }).join(' ');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseOpencodeImageQueryArgs(process.argv.slice(2));
    process.exitCode = await runOpencodeImageQuery(args);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(getOpencodeImageQueryUsage());
      process.exitCode = 0;
    } else if (error instanceof Error) {
      process.stderr.write(`${error.message}\n\n${getOpencodeImageQueryUsage()}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
