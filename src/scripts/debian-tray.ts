import { createServiceControl } from '../operations/service-control.js';
import { createTrayApp } from '../tray/tray-app.js';
import { createDebianTrayRuntime } from '../tray/debian-tray-runtime.js';

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
