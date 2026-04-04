import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createServiceControl } from '../operations/service-control.js';
import { createTrayApp } from '../tray/tray-app.js';
import { createDebianTrayRuntime } from '../tray/debian-tray-runtime.js';
import { shouldDetachDebianTrayProcess } from './debian-tray-launch.js';

if (shouldDetachDebianTrayProcess(process.env)) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      GAMECLUB_TRAY_CHILD: '1',
    },
  });
  child.unref();
  process.exit(0);
}

const serviceName = process.env.GAMECLUB_SERVICE_NAME ?? 'gameclubtelegrambot.service';
const pollIntervalMs = Number(process.env.GAMECLUB_TRAY_POLL_MS ?? '5000');

const trayApp = createTrayApp({
  serviceControl: createServiceControl({ serviceName }),
  runtime: createDebianTrayRuntime(),
  pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 5000,
});

await trayApp.start();

const stop = async () => {
  await trayApp.stop();
};

process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});
