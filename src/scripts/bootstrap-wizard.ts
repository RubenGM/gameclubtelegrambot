import pino from 'pino';

import {
  initializeBootstrapDatabase,
  rollbackBootstrapDatabaseInitialization,
} from '../bootstrap/bootstrap-database.js';
import { initializeSystemFromCandidate } from '../bootstrap/initialize-system.js';
import { loadWizardDefaults } from '../bootstrap/wizard/default-wizard-values.js';
import { runBootstrapWizard } from '../bootstrap/wizard/run-bootstrap-wizard.js';
import { createTerminalWizardIo } from '../bootstrap/wizard/terminal-wizard-io.js';
import { defaultRuntimeConfigPath } from '../config/runtime-config.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

const io = createTerminalWizardIo();

try {
  const defaults = await loadWizardDefaults();
  const result = await runBootstrapWizard({ defaults, io });

  if (result) {
    const configPath = process.env.GAMECLUB_CONFIG_PATH ?? defaultRuntimeConfigPath;

    const initialization = await initializeSystemFromCandidate({
      candidate: result,
      configPath,
      logger,
      initializeDatabase: async ({ persistedConfig }) => {
        await initializeBootstrapDatabase({ persistedConfig });
      },
      rollbackDatabaseInitialization: async ({ persistedConfig }) => {
        await rollbackBootstrapDatabaseInitialization({ persistedConfig });
      },
    });

    logger.info(
      {
        configPath,
        firstAdminTelegramUserId: initialization.config.bootstrap.firstAdmin.telegramUserId,
      },
      'Bootstrap wizard completed and persisted the initialized system',
    );
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
