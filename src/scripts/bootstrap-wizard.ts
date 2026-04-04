import pino from 'pino';

import { runBootstrapWizard } from '../bootstrap/wizard/run-bootstrap-wizard.js';
import { createTerminalWizardIo } from '../bootstrap/wizard/terminal-wizard-io.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

const io = createTerminalWizardIo();

try {
  const result = await runBootstrapWizard({ io });

  if (result) {
    logger.info({}, 'Bootstrap wizard completed with a valid in-memory configuration candidate');
  } else {
    logger.info({}, 'Bootstrap wizard cancelled by the operator before persistence');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  logger.fatal({ error: message }, 'Bootstrap wizard failed');
  process.exitCode = 1;
} finally {
  await io.close?.();
}
