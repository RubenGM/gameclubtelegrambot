import pino from 'pino';

import { createApp } from './bootstrap/create-app.js';

const logger = pino({
  name: 'gameclubtelegrambot',
});

const app = createApp({ logger });

await app.start();
