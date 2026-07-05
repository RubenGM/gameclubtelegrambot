import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

import type { PrintJobSides } from './print-job-history.js';

export interface PrintingProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type PrintingProcessRunner = (command: string, args: string[]) => Promise<PrintingProcessResult>;
export type PrintJobOrientation = 'portrait' | 'landscape';

export interface PrintService {
  inspectPdf(pdfPath: string): Promise<{ pageCount: number }>;
  convertOfficeToPdf(inputPath: string, outputDir: string): Promise<string>;
  convertImageToPdf(inputPath: string, outputDir: string, orientation: PrintJobOrientation): Promise<string>;
  getPrinterStatus(queue: string): Promise<{ queue: string; duplexSupported: boolean }>;
  submitPdfJob(input: {
    pdfPath: string;
    queue: string;
    copies: number;
    pageRanges: string;
    sides: PrintJobSides;
    orientation: PrintJobOrientation;
  }): Promise<{ cupsJobId: string | null }>;
  cleanup(paths: string[]): Promise<void>;
}

export function createPrintService({
  runner = createNodeProcessRunner(),
  fileSystem = { rm: removePath },
}: {
  runner?: PrintingProcessRunner;
  fileSystem?: { rm(path: string): Promise<void> };
} = {}): PrintService {
  return {
    async inspectPdf(pdfPath) {
      const result = await runChecked(runner, 'pdfinfo', [pdfPath]);
      const pageCount = parsePdfInfoPageCount(result.stdout);
      if (!pageCount) {
        throw new Error('pdfinfo did not report a valid page count');
      }
      return { pageCount };
    },
    async convertOfficeToPdf(inputPath, outputDir) {
      await runChecked(runner, 'soffice', [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        inputPath,
      ]);
      return join(outputDir, `${basename(inputPath, extname(inputPath))}.pdf`);
    },
    async convertImageToPdf(inputPath, outputDir, orientation) {
      const outputPath = join(outputDir, `${basename(inputPath, extname(inputPath))}.pdf`);
      const pageSize = orientation === 'landscape' ? '842x595' : '595x842';
      await runChecked(runner, 'magick', [
        inputPath,
        '-auto-orient',
        '-resize',
        `${pageSize}>`,
        '-gravity',
        'center',
        '-background',
        'white',
        '-extent',
        pageSize,
        outputPath,
      ]);
      return outputPath;
    },
    async getPrinterStatus(queue) {
      const result = await runChecked(runner, 'lpoptions', ['-p', queue, '-l']);
      return {
        queue,
        duplexSupported: detectDuplexSupport(result.stdout),
      };
    },
    async submitPdfJob({ pdfPath, queue, copies, pageRanges, sides, orientation }) {
      const result = await runChecked(runner, 'lp', [
        '-d',
        queue,
        '-n',
        String(copies),
        '-o',
        `page-ranges=${pageRanges}`,
        '-o',
        `sides=${sides}`,
        '-o',
        `orientation-requested=${orientation === 'landscape' ? 4 : 3}`,
        pdfPath,
      ]);

      return { cupsJobId: parseCupsJobId(result.stdout) };
    },
    async cleanup(paths) {
      for (const path of paths) {
        try {
          await fileSystem.rm(path);
        } catch {
          // Temporary cleanup is best effort; callers should not fail the user action only because cleanup failed.
        }
      }
    },
  };
}

function createNodeProcessRunner(): PrintingProcessRunner {
  const execFileAsync = promisify(execFile);
  return async (command, args) => {
    try {
      const result = await execFileAsync(command, args, { timeout: 60_000 });
      return {
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        exitCode: 0,
      };
    } catch (error) {
      const failed = error as { stdout?: unknown; stderr?: unknown; code?: unknown; message?: string };
      return {
        stdout: String(failed.stdout ?? ''),
        stderr: String(failed.stderr ?? failed.message ?? ''),
        exitCode: typeof failed.code === 'number' ? failed.code : 1,
      };
    }
  };
}

async function runChecked(
  runner: PrintingProcessRunner,
  command: string,
  args: string[],
): Promise<PrintingProcessResult> {
  const result = await runner(command, args);
  if (result.exitCode !== 0) {
    throw new Error(`${command} exited with code ${result.exitCode}: ${result.stderr}`.trim());
  }
  return result;
}

function parsePdfInfoPageCount(stdout: string): number | null {
  const match = /^Pages:\s+(\d+)$/im.exec(stdout);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseCupsJobId(stdout: string): string | null {
  return /request id is\s+([^\s]+)/i.exec(stdout)?.[1] ?? null;
}

function detectDuplexSupport(lpoptionsOutput: string): boolean {
  const duplexerMatch = /(?:^|\n)[^\n]*Duplexer[^:\n]*:\s*([^\n]*)/i.exec(lpoptionsOutput);
  if (duplexerMatch && /\*False\b/i.test(duplexerMatch[1] ?? '')) {
    return false;
  }

  return /(?:^|\n)Duplex\/.*:\s*.*(?:DuplexNoTumble|DuplexTumble|two-sided)/i.test(lpoptionsOutput);
}

async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
