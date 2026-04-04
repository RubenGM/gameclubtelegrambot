import type { ServiceControl, ServiceLifecycleState } from '../operations/service-control.js';

export type TrayStatusIndicator = ServiceLifecycleState | 'busy';

export type TrayActionId = 'status' | 'start' | 'stop' | 'restart' | 'rebuild-restart' | 'logs' | 'refresh' | 'quit';

export interface TrayMenuItem {
  id: TrayActionId;
  title: string;
  enabled: boolean;
}

export interface TrayRuntime {
  start(): Promise<void>;
  onAction(handler: (actionId: TrayActionId) => Promise<void>): void;
  setSnapshot(snapshot: { items: TrayMenuItem[]; state: TrayStatusIndicator; tooltip: string }): Promise<void>;
  setMenu(items: TrayMenuItem[]): Promise<void>;
  setStatus(state: TrayStatusIndicator): Promise<void>;
  setTooltip(text: string): Promise<void>;
  showNotification(title: string, message: string): Promise<void>;
  showTextWindow(title: string, content: string): Promise<void>;
  stop(): Promise<void>;
}

export interface TrayScheduler {
  scheduleEvery(ms: number, callback: () => Promise<void> | void): { cancel(): void };
}

export interface CreateTrayAppOptions {
  serviceControl: ServiceControl;
  runtime: TrayRuntime;
  rebuildAndRestart?: (() => Promise<void>) | undefined;
  pollIntervalMs?: number;
  scheduler?: TrayScheduler;
}

export interface TrayApp {
  start(): Promise<void>;
  stop(): Promise<void>;
  refresh(): Promise<void>;
}

const defaultPollIntervalMs = 5000;

export function createTrayApp({
  serviceControl,
  runtime,
  rebuildAndRestart,
  pollIntervalMs = defaultPollIntervalMs,
  scheduler = createDefaultScheduler(),
}: CreateTrayAppOptions): TrayApp {
  let currentState: ServiceLifecycleState = 'unknown';
  let disposed = false;
  let timer: { cancel(): void } | null = null;

  const render = async ({
    state,
    busy = false,
  }: {
    state: ServiceLifecycleState;
    busy?: boolean;
  }) => {
    await runtime.setSnapshot({
      state: busy ? 'busy' : state,
      tooltip: `Game Club Bot: ${statusLabel(state)}`,
      items: buildMenu({ state, busy }),
    });
  };

  const refresh = async () => {
    const status = await serviceControl.getServiceStatus();
    currentState = status.state;
    await render({ state: currentState });
  };

  const handleAction = async (actionId: TrayActionId) => {
    if (disposed) {
      return;
    }

    if (actionId === 'quit') {
      await stop();
      return;
    }

    if (actionId === 'refresh') {
      await refreshWithNotification();
      return;
    }

    if (actionId === 'logs') {
      try {
        const logs = await serviceControl.readRecentLogs({ lines: 50 });
        await runtime.showTextWindow('Game Club Bot logs', logs);
      } catch (error) {
        await runtime.showNotification('Game Club Bot', errorMessage(error));
      }
      return;
    }

    if (actionId === 'rebuild-restart') {
      if (!rebuildAndRestart) {
        await runtime.showNotification('Game Club Bot', 'Aquesta instal.lacio no te habilitada l accio rebuild and restart.');
        return;
      }

      await render({ state: currentState, busy: true });

      try {
        await rebuildAndRestart();
      } catch (error) {
        await runtime.showNotification('Game Club Bot', errorMessage(error));
      }

      await refreshWithNotification(false);
      return;
    }

    if (actionId === 'start' || actionId === 'stop' || actionId === 'restart') {
      await render({ state: currentState, busy: true });

      try {
        if (actionId === 'start') {
          await serviceControl.startService();
        } else if (actionId === 'stop') {
          await serviceControl.stopService();
        } else {
          await serviceControl.restartService();
        }
      } catch (error) {
        await runtime.showNotification('Game Club Bot', errorMessage(error));
      }

      await refreshWithNotification(false);
    }
  };

  const refreshWithNotification = async (notifyOnError = true) => {
    try {
      await refresh();
    } catch (error) {
      currentState = 'unknown';
      await render({ state: currentState });
      if (notifyOnError) {
        await runtime.showNotification('Game Club Bot', errorMessage(error));
      }
    }
  };

  const stop = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    timer?.cancel();
    timer = null;
    await runtime.stop();
  };

  return {
    async start() {
      await runtime.start();
      runtime.onAction(handleAction);
      await refreshWithNotification();
      timer = scheduler.scheduleEvery(pollIntervalMs, async () => {
        await refreshWithNotification(false);
      });
    },
    stop,
    async refresh() {
      await refreshWithNotification();
    },
  };
}

function buildMenu({
  state,
  busy,
}: {
  state: ServiceLifecycleState;
  busy: boolean;
}): TrayMenuItem[] {
  const controlEnabled = !busy;

  return [
    { id: 'status', title: `Status: ${statusTitle(state)}`, enabled: false },
    { id: 'start', title: 'Start', enabled: controlEnabled && state !== 'active' && state !== 'activating' },
    { id: 'stop', title: 'Stop', enabled: controlEnabled && state !== 'inactive' && state !== 'deactivating' },
    { id: 'restart', title: 'Restart', enabled: controlEnabled && state !== 'deactivating' },
    { id: 'rebuild-restart', title: 'Rebuild and restart', enabled: controlEnabled },
    { id: 'logs', title: 'View last logs', enabled: true },
    { id: 'refresh', title: 'Refresh', enabled: controlEnabled },
    { id: 'quit', title: 'Quit tray', enabled: true },
  ];
}

function statusTitle(state: ServiceLifecycleState): string {
  switch (state) {
    case 'active':
      return 'Bot actiu';
    case 'inactive':
      return 'Bot aturat';
    case 'failed':
      return 'Bot en error';
    case 'activating':
      return 'Arrencant';
    case 'deactivating':
      return 'Aturant';
    default:
      return 'Estat desconegut';
  }
}

function statusLabel(state: ServiceLifecycleState): string {
  switch (state) {
    case 'active':
      return 'actiu';
    case 'inactive':
      return 'aturat';
    case 'failed':
      return 'en error';
    case 'activating':
      return 'arrencant';
    case 'deactivating':
      return 'aturant';
    default:
      return 'estat desconegut';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultScheduler(): TrayScheduler {
  return {
    scheduleEvery(ms, callback) {
      const handle = setInterval(() => {
        void callback();
      }, ms);

      return {
        cancel() {
          clearInterval(handle);
        },
      };
    },
  };
}
