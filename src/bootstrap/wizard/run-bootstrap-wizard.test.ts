import test from 'node:test';
import assert from 'node:assert/strict';

import { runBootstrapWizard } from './run-bootstrap-wizard.js';

test('runBootstrapWizard collects a complete runtime config candidate with defaults and masked summary', async () => {
  const prompts: string[] = [];
  const outputs: string[] = [];

  const config = await runBootstrapWizard({
    io: createIoDouble(
      [
        'Game Club Bot',
        'Game Club',
        'telegram-secret-token',
        '',
        '',
        '',
        '',
        'super-db-secret',
        'admin-secret',
        '123456789',
        '',
        'Club Administrator',
        '',
        '',
        '',
      ],
      [true],
      prompts,
      outputs,
    ),
  });

  assert.deepEqual(prompts, [
    'Nom public del bot',
    'Nom del club',
    'Token del bot de Telegram',
    'Host de PostgreSQL',
    'Port de PostgreSQL',
    'Nom de la base de dades',
    'Usuari de la base de dades',
    'Contrasenya de la base de dades',
    'Contrasenya d elevacio administrativa',
    'Telegram user ID del primer administrador',
    'Username del primer administrador',
    'Nom visible del primer administrador',
    'Activar anuncis de grup per defecte',
    'Activar recordatoris d esdeveniments per defecte',
    'Antelacio dels recordatoris en hores',
  ]);

  assert.equal(config?.schemaVersion, 1);
  assert.equal(config?.database.host, '127.0.0.1');
  assert.equal(config?.database.port, 55432);
  assert.equal(config?.database.name, 'gameclub');
  assert.equal(config?.database.user, 'gameclub_user');
  assert.equal(config?.database.password, 'super-db-secret');
  assert.equal(config?.bootstrap.firstAdmin.telegramUserId, 123456789);
  assert.equal(config?.bootstrap.firstAdmin.username, undefined);
  assert.equal(config?.notifications.defaults.groupAnnouncementsEnabled, true);
  assert.equal(config?.notifications.defaults.eventRemindersEnabled, true);
  assert.equal(config?.notifications.defaults.eventReminderLeadHours, 24);

  const renderedOutput = outputs.join('\n');
  assert.match(renderedOutput, /Resum de la configuracio recollida/);
  assert.doesNotMatch(renderedOutput, /telegram-secret-token/);
  assert.doesNotMatch(renderedOutput, /super-db-secret/);
  assert.doesNotMatch(renderedOutput, /admin-secret/);
  assert.match(renderedOutput, /Token de Telegram: \[valor ocult, 21 caracters\]/);
  assert.match(renderedOutput, /Contrasenya de base de dades: \[valor ocult, 15 caracters\]/);
  assert.match(renderedOutput, /Contrasenya admin: \[valor ocult, 12 caracters\]/);
});

test('runBootstrapWizard retries invalid answers with clear guidance', async () => {
  const outputs: string[] = [];

  const config = await runBootstrapWizard({
    io: createIoDouble(
      [
        '',
        'Game Club Bot',
        'Game Club',
        'telegram-token',
        '',
        'abc',
        '55432',
        '',
        '',
        'super-db-secret',
        'admin-secret',
        '0',
        '123456789',
        '',
        'Club Administrator',
        'maybe',
        'n',
        '',
        '500',
        '24',
      ],
      [true],
      [],
      outputs,
    ),
  });

  assert.equal(config?.bot.publicName, 'Game Club Bot');
  assert.equal(config?.notifications.defaults.groupAnnouncementsEnabled, false);
  assert.equal(config?.notifications.defaults.eventReminderLeadHours, 24);

  const renderedOutput = outputs.join('\n');
  assert.match(renderedOutput, /El valor no pot quedar buit/);
  assert.match(renderedOutput, /Introdueix un numero enter valid/);
  assert.match(renderedOutput, /Introdueix un numero enter entre 1 i 2147483647/);
  assert.match(renderedOutput, /Respon si o no/);
  assert.match(renderedOutput, /Introdueix un numero enter entre 1 i 168/);
});

test('runBootstrapWizard returns null when the operator rejects the final confirmation', async () => {
  const config = await runBootstrapWizard({
    io: createIoDouble(
      [
        'Game Club Bot',
        'Game Club',
        'telegram-token',
        '',
        '',
        '',
        '',
        'super-db-secret',
        'admin-secret',
        '123456789',
        '',
        'Club Administrator',
        '',
        '',
        '',
      ],
      [false],
      [],
      [],
    ),
  });

  assert.equal(config, null);
});

test('runBootstrapWizard can accept secret and database defaults loaded externally', async () => {
  const prompts: string[] = [];

  const config = await runBootstrapWizard({
    defaults: {
      databaseHost: '127.0.0.1',
      databasePort: 55432,
      databaseName: 'gameclub',
      databaseUser: 'gameclub_user',
      databasePassword: 'postgres-local-secret',
      databaseSsl: false,
      groupAnnouncementsEnabled: true,
      eventRemindersEnabled: true,
      eventReminderLeadHours: 24,
    },
    io: createIoDouble(
      [
        'Game Club Bot',
        'Game Club',
        'telegram-secret-token',
        '',
        '',
        '',
        '',
        '',
        'admin-secret',
        '123456789',
        '',
        'Club Administrator',
        '',
        '',
        '',
      ],
      [true],
      prompts,
      [],
    ),
  });

  assert.equal(config?.database.password, 'postgres-local-secret');
  assert.match(prompts[7] ?? '', /Contrasenya de la base de dades/);
});

function createIoDouble(
  textResponses: string[],
  confirmResponses: boolean[],
  prompts: string[],
  outputs: string[],
) {
  return {
    async prompt(options: { label: string }) {
      prompts.push(options.label);

      const value = textResponses.shift();
      if (value === undefined) {
        throw new Error(`Missing text response for prompt: ${options.label}`);
      }

      return value;
    },
    async confirm(_message: string) {
      const value = confirmResponses.shift();
      if (value === undefined) {
        throw new Error('Missing confirm response');
      }

      return value;
    },
    writeLine(message: string) {
      outputs.push(message);
    },
  };
}
