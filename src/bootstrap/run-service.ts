import { createApp } from './create-app.js';

export interface ServiceLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
  fatal(bindings: object, message: string): void;
}

export interface RunnableApp {
  start(): Promise<unknown>;
  stop(): Promise<void>;
  onFatalRuntimeError?(handler: (error: unknown) => void): void;
}

export interface ProcessInterfaceLike {
  once(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  on(event: 'uncaughtException' | 'unhandledRejection', handler: (error: unknown) => void): this;
  removeListener(event: string, handler: (...args: unknown[]) => void): this;
}

export interface RunServiceOptions {
  logger: ServiceLogger;
  createApp?: (() => Promise<RunnableApp>) | (() => RunnableApp);
  processInterface?: ProcessInterfaceLike;
}

export async function runService({
  logger,
  createApp: createRunnableApp,
  processInterface = process,
}: RunServiceOptions): Promise<number> {
  logger.info({}, 'Service startup initiated');

  const app = createRunnableApp
    ? await Promise.resolve(createRunnableApp())
    : await Promise.reject(new Error('createApp is required'));
  let shuttingDown: Promise<number> | undefined;

  const shutdown = (reason: string, exitCode: number, level: 'info' | 'fatal', error?: unknown) => {
    if (shuttingDown) {
      return shuttingDown;
    }

    if (level === 'fatal') {
      logger.fatal({ error: errorMessage(error) }, reason);
    } else {
      logger.info({}, reason);
    }

    shuttingDown = (async () => {
      try {
        await app.stop();
      } finally {
        logger.info({}, 'Service shutdown completed');
      }

      return exitCode;
    })();

    return shuttingDown;
  };

  const handleSigint = () => {
    void shutdown('Shutdown signal received', 0, 'info');
  };
  const handleSigterm = () => {
    void shutdown('Shutdown signal received', 0, 'info');
  };
  const handleUncaughtException = (error: unknown) => {
    void shutdown('Unhandled exception detected', 1, 'fatal', error);
  };
  const handleUnhandledRejection = (error: unknown) => {
    void shutdown('Unhandled promise rejection detected', 1, 'fatal', error);
  };

  app.onFatalRuntimeError?.((error) => {
    void shutdown('Fatal runtime error detected', 1, 'fatal', error);
  });

  processInterface.once('SIGINT', handleSigint);
  processInterface.once('SIGTERM', handleSigterm);
  processInterface.on('uncaughtException', handleUncaughtException);
  processInterface.on('unhandledRejection', handleUnhandledRejection);

  try {
    await app.start();
    logger.info({}, 'Service startup completed');

    return await new Promise<number>((resolve) => {
      const poll = () => {
        if (shuttingDown) {
          void shuttingDown.then(resolve);
          return;
        }

        setImmediate(poll);
      };

      poll();
    });
  } finally {
    processInterface.removeListener('uncaughtException', handleUncaughtException);
    processInterface.removeListener('unhandledRejection', handleUnhandledRejection);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
