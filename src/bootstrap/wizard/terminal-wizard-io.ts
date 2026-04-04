import { Writable } from 'node:stream';
import { createInterface, type Interface } from 'node:readline/promises';

import type { PromptOptions, WizardIo } from './run-bootstrap-wizard.js';

export function createTerminalWizardIo(): WizardIo {
  const mutableStdout = new MutableStdout(process.stdout);
  const terminal = createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });

  return {
    async prompt(options: PromptOptions): Promise<string> {
      const promptText = formatPromptLabel(options.label, options.defaultValue);

      if (options.secret) {
        process.stdout.write(promptText);
      }

      try {
        const value = options.secret
          ? await askHiddenQuestion(terminal, mutableStdout)
          : await terminal.question(promptText);

        if (options.secret) {
          process.stdout.write('\n');
        }

        return value;
      } finally {
        mutableStdout.muted = false;
      }
    },
    async confirm(message: string): Promise<boolean> {
      const answer = await terminal.question(`${message} [si/no] (si): `);
      const normalized = answer.trim().toLowerCase();

      if (normalized.length === 0) {
        return true;
      }

      return ['si', 's', 'yes', 'y'].includes(normalized);
    },
    writeLine(message: string): void {
      mutableStdout.write(`${message}\n`);
    },
    close(): void {
      terminal.close();
    },
  };
}

class MutableStdout extends Writable {
  public muted = false;

  constructor(private readonly target: NodeJS.WriteStream) {
    super();
  }

  override _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      this.target.write(chunk, encoding);
    }

    callback();
  }
}

async function askHiddenQuestion(terminal: Interface, mutableStdout: MutableStdout): Promise<string> {
  mutableStdout.muted = true;

  try {
    return await terminal.question('');
  } finally {
    mutableStdout.muted = false;
  }
}

function formatPromptLabel(label: string, defaultValue?: string): string {
  if (defaultValue !== undefined) {
    if (label.toLowerCase().includes('contrasenya') || label.toLowerCase().includes('token')) {
      return `${label} ([valor per defecte disponible]): `;
    }

    return `${label} (${defaultValue}): `;
  }

  return `${label}: `;
}
