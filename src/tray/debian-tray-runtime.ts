import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TrayActionId, TrayMenuItem, TrayRuntime, TrayStatusIndicator } from './tray-app.js';

type HostMessage =
  | { type: 'ready' }
  | { type: 'click'; actionId: TrayActionId }
  | { type: 'error'; message: string };

type HostCommand =
  | {
      type: 'snapshot';
      status: TrayStatusIndicator;
      tooltip: string;
      items: TrayMenuItem[];
    }
  | { type: 'quit' };

export interface TrayHostProcessLike {
  stdout: {
    on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  };
  stderr: {
    on(event: 'data', listener: (chunk: string | Buffer) => void): unknown;
  };
  stdin: {
    write(chunk: string): boolean;
  };
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface CreateDebianTrayRuntimeOptions {
  spawnHost?: () => Promise<TrayHostProcessLike>;
}

export function createDebianTrayRuntime(
  options: CreateDebianTrayRuntimeOptions = {},
): TrayRuntime {
  return new DebianTrayRuntime(options.spawnHost ?? spawnDebianTrayHost);
}

class DebianTrayRuntime implements TrayRuntime {
  private host: TrayHostProcessLike | null = null;
  private items: TrayMenuItem[] = [];
  private tooltip = 'Game Club Bot';
  private status: TrayStatusIndicator = 'unknown';
  private actionHandler: ((actionId: TrayActionId) => Promise<void>) | null = null;
  private lastSnapshotJson: string | null = null;

  constructor(private readonly spawnHost: () => Promise<TrayHostProcessLike>) {}

  async start(): Promise<void> {
    const host = await this.spawnHost();
    this.host = host;

    host.stderr.on('data', () => {
      // Best effort only. The controlling app already has operator-facing error paths.
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let buffer = '';

      host.once('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          reject(new Error(`El host de safata ha finalitzat abans d estar llest (code=${code}, signal=${signal}).`));
        }
      });

      host.stdout.on('data', (chunk) => {
        buffer += chunk.toString();

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex < 0) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }

          const message = parseHostMessage(line);
          if (!message) {
            continue;
          }

          if (!settled && message.type === 'ready') {
            settled = true;
            resolve();
            continue;
          }

          void this.handleHostMessage(message);
        }
      });
    });

  }

  onAction(handler: (actionId: TrayActionId) => Promise<void>): void {
    this.actionHandler = handler;
  }

  async setSnapshot(snapshot: { items: TrayMenuItem[]; state: TrayStatusIndicator; tooltip: string }): Promise<void> {
    this.items = snapshot.items;
    this.status = snapshot.state;
    this.tooltip = snapshot.tooltip;
    await this.pushSnapshot();
  }

  async setMenu(items: TrayMenuItem[]): Promise<void> {
    this.items = items;
    await this.pushSnapshot();
  }

  async setStatus(state: TrayStatusIndicator): Promise<void> {
    this.status = state;
    await this.pushSnapshot();
  }

  async setTooltip(text: string): Promise<void> {
    this.tooltip = text;
    await this.pushSnapshot();
  }

  async showNotification(title: string, message: string): Promise<void> {
    await trySpawnDetached('notify-send', [title, message]);
  }

  async showTextWindow(title: string, content: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'gameclubtelegrambot-tray-'));
    const filePath = join(directory, 'logs.txt');
    await writeFile(filePath, content, 'utf8');
    await trySpawnDetached('xdg-open', [filePath], title, `Logs disponibles a ${filePath}`);
  }

  async stop(): Promise<void> {
    if (!this.host) {
      return;
    }

    this.sendCommand({ type: 'quit' });
    this.host.kill('SIGTERM');
    this.host = null;
    this.lastSnapshotJson = null;
  }

  private async handleHostMessage(message: HostMessage): Promise<void> {
    if (message.type === 'click' && this.actionHandler) {
      await this.actionHandler(message.actionId);
    }
  }

  private async pushSnapshot(): Promise<void> {
    if (!this.host) {
      return;
    }

    const command: HostCommand = {
      type: 'snapshot',
      status: this.status,
      tooltip: this.tooltip,
      items: this.items,
    };
    const snapshotJson = JSON.stringify(command);

    if (snapshotJson === this.lastSnapshotJson) {
      return;
    }

    this.lastSnapshotJson = snapshotJson;
    this.host.stdin.write(`${snapshotJson}\n`);
  }

  private sendCommand(command: HostCommand): void {
    if (!this.host) {
      return;
    }

    this.host.stdin.write(`${JSON.stringify(command)}\n`);
  }
}

function parseHostMessage(line: string): HostMessage | null {
  try {
    const parsed = JSON.parse(line) as HostMessage;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }

    if (parsed.type === 'ready') {
      return parsed;
    }

    if (
        parsed.type === 'click' &&
        (parsed.actionId === 'status' ||
          parsed.actionId === 'start' ||
          parsed.actionId === 'stop' ||
          parsed.actionId === 'restart' ||
          parsed.actionId === 'rebuild-restart' ||
          parsed.actionId === 'logs' ||
          parsed.actionId === 'refresh' ||
          parsed.actionId === 'quit')
    ) {
      return parsed;
    }

    if (parsed.type === 'error' && typeof parsed.message === 'string') {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

async function spawnDebianTrayHost(): Promise<TrayHostProcessLike> {
  const projectRoot = resolveProjectRoot();
  const helperPath = join(projectRoot, 'scripts', 'debian-tray-host.py');
  const child = spawn('python3', [helperPath], {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return child as unknown as TrayHostProcessLike;
}

function resolveProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), '..', '..');
}

async function trySpawnDetached(
  command: string,
  args: string[],
  fallbackTitle?: string,
  fallbackMessage?: string,
): Promise<void> {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    if (fallbackTitle && fallbackMessage) {
      try {
        const child = spawn('notify-send', [fallbackTitle, fallbackMessage], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } catch {
        // Best-effort UI fallback only.
      }
    }
  }
}
