import { setDefaultResultOrder } from 'node:dns';
import pino from 'pino';

import { runMain } from './main-program.js';

try {
  setDefaultResultOrder('ipv4first');
} catch {
  // Ignore in environments where setDefaultResultOrder is not supported.
}

const logger = pino({
  name: 'gameclubtelegrambot',
});

process.exitCode = await runMain({ logger });
