import pino from 'pino';

import { runBootstrapFlow } from '../bootstrap/run-bootstrap-flow.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

try {
  await runBootstrapFlow({ logger });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.fatal({ error: message }, 'Bootstrap wizard failed');
  process.exitCode = 1;
}
