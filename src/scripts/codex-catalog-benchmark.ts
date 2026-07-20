import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runCodexPromptCapture } from './codex-prompt.js';

export const defaultBenchmarkModels = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.4-mini', 'gpt-5.4'] as const;

type BenchmarkOptions = {
  models: string[];
  runs: number;
  codexBin: string;
  reasoningEffort: string;
  outputDir: string;
};

type BenchmarkSample = {
  workload: string;
  elapsedMs: number;
  success: boolean;
  reliable: boolean;
  error?: string;
};

const workloads = [
  {
    name: 'catalog_translation',
    prompt: [
      'Traduce al castellano esta descripción de un juego de mesa.',
      'Devuelve solo la traducción, sin encabezados ni markdown.',
      '',
      'Explore the archipelago, collect resources, and build a thriving trade route for 2 to 4 players.',
    ].join('\n'),
    isReliable: (output: string) => /archipiélago/i.test(output) && /recursos/i.test(output) && /(?:2|dos)\s*(a|–|-)\s*(?:4|cuatro)/i.test(output),
  },
  {
    name: 'catalog_title_extraction_contract',
    prompt: [
      'Responde exactamente con el texto entre comillas y sin añadir nada: "El castillo de Borgoña".',
      'Esta comprobación valida que el modelo respeta el contrato de salida breve usado al leer títulos de portadas.',
    ].join('\n'),
    isReliable: (output: string) => output.trim() === 'El castillo de Borgoña',
  },
] as const;

export function parseBenchmarkOptions(argv: string[]): BenchmarkOptions {
  let models: string[] = [...defaultBenchmarkModels];
  let runs = 2;
  let codexBin = './scripts/codex-cawa.sh';
  let reasoningEffort = 'low';
  let outputDir = 'data/codex-benchmarks';
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index] ?? '';
    if (option === '--help' || option === '-h') throw new HelpRequested();
    if (!['--models', '--runs', '--codex-bin', '--reasoning', '--output-dir'].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    if (option === '--models') models = value.split(',').map((model) => model.trim()).filter(Boolean);
    else if (option === '--runs') {
      runs = Number(value);
      if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer between 1 and 10');
    } else if (option === '--codex-bin') codexBin = value;
    else if (option === '--reasoning') reasoningEffort = value;
    else outputDir = value;
    index += 1;
  }
  if (models.length === 0) throw new Error('--models must contain at least one model');
  return { models, runs, codexBin, reasoningEffort, outputDir };
}

export async function runBenchmark(options: BenchmarkOptions): Promise<{ outputPath: string; results: Array<Record<string, unknown>> }> {
  const results: Array<Record<string, unknown>> = [];
  for (const model of options.models) {
    const samples: BenchmarkSample[] = [];
    for (let run = 0; run < options.runs; run += 1) {
      for (const workload of workloads) {
        const startedAt = Date.now();
        try {
          const output = await runCodexPromptCapture({
            prompt: workload.prompt,
            model,
            codexBin: options.codexBin,
            reasoningEffort: options.reasoningEffort,
          });
          samples.push({ workload: workload.name, elapsedMs: Date.now() - startedAt, success: true, reliable: workload.isReliable(output) });
        } catch (error) {
          samples.push({
            workload: workload.name,
            elapsedMs: Date.now() - startedAt,
            success: false,
            reliable: false,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          });
        }
      }
    }
    const completed = samples.filter((sample) => sample.success);
    results.push({
      model,
      runs: options.runs,
      requests: samples.length,
      successfulRequests: completed.length,
      reliableResponses: samples.filter((sample) => sample.reliable).length,
      meanElapsedMs: completed.length ? Math.round(completed.reduce((sum, sample) => sum + sample.elapsedMs, 0) / completed.length) : null,
      p95ElapsedMs: completed.length ? percentile(completed.map((sample) => sample.elapsedMs), 0.95) : null,
      cost: null,
      costStatus: 'n/d: Codex CLI no expone tokens ni coste facturable de forma fiable.',
      samples,
    });
  }
  const generatedAt = new Date().toISOString();
  await mkdir(options.outputDir, { recursive: true });
  const outputPath = join(options.outputDir, `catalog-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.json`);
  await writeFile(outputPath, `${JSON.stringify({ generatedAt, options: { ...options, outputDir: undefined }, results }, null, 2)}\n`, 'utf8');
  return { outputPath, results };
}

function percentile(values: number[], target: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * target) - 1)] ?? 0;
}

export class HelpRequested extends Error {}

const usage = `Usage: npm run codex:benchmark -- [--models luna,terra] [--runs 2] [--reasoning low]\n`;

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runBenchmark(parseBenchmarkOptions(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(usage);
      process.exitCode = 0;
    } else if (error instanceof Error) {
      process.stderr.write(`${error.message}\n${usage}`);
      process.exitCode = 1;
    } else throw error;
  }
}
