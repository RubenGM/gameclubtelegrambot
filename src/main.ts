import pino from 'pino';

import { runMain } from './main-program.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

process.exitCode = await runMain({ logger });
