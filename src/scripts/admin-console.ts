import { createAdminConsoleOperations } from '../operations/admin-console.js';
import { AdminConsoleApp } from '../tui/admin-console-app.js';

const serviceName = process.env.GAMECLUB_SERVICE_NAME ?? 'gameclubtelegrambot.service';
const pollIntervalMs = Number(process.env.GAMECLUB_ADMIN_CONSOLE_POLL_MS ?? '8000');
const operatorTelegramUserId = Number(process.env.GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID ?? '0');

const app = new AdminConsoleApp({
  operations: createAdminConsoleOperations({
    serviceName,
  }),
  pollIntervalMs: Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 8000,
  operatorTelegramUserId: Number.isFinite(operatorTelegramUserId) ? operatorTelegramUserId : 0,
});

await app.run();
