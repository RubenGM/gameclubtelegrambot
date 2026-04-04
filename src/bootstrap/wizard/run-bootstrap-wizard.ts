import {
  bootstrapConfigCandidateSchema,
  type BootstrapConfigCandidate,
} from './bootstrap-config-candidate.js';

export interface WizardIo {
  prompt(options: PromptOptions): Promise<string>;
  confirm(message: string): Promise<boolean>;
  writeLine(message: string): void;
  close?(): void | Promise<void>;
}

export interface PromptOptions {
  label: string;
  defaultValue?: string;
  secret?: boolean;
}

export interface RunBootstrapWizardOptions {
  io: WizardIo;
}

const defaultWizardValues = {
  databaseHost: '127.0.0.1',
  databasePort: 55432,
  databaseName: 'gameclub',
  databaseUser: 'gameclub_user',
  databaseSsl: false,
  groupAnnouncementsEnabled: true,
  eventRemindersEnabled: true,
  eventReminderLeadHours: 24,
} as const;

export async function runBootstrapWizard({ io }: RunBootstrapWizardOptions): Promise<BootstrapConfigCandidate | null> {
  io.writeLine('Assistente de configuracio inicial de Game Club Telegram Bot');
  io.writeLine('Respon les preguntes seguents. Pots acceptar els valors per defecte quan apareguin.');

  const candidate = bootstrapConfigCandidateSchema.parse({
    bot: {
      publicName: await promptRequiredText(io, 'Nom public del bot'),
      clubName: await promptRequiredText(io, 'Nom del club'),
    },
    telegram: {
      token: await promptRequiredText(io, 'Token del bot de Telegram', { secret: true }),
    },
    database: {
      host: await promptRequiredText(io, 'Host de PostgreSQL', {
        defaultValue: defaultWizardValues.databaseHost,
      }),
      port: await promptInteger(io, 'Port de PostgreSQL', {
        defaultValue: String(defaultWizardValues.databasePort),
        min: 1,
        max: 65535,
      }),
      name: await promptRequiredText(io, 'Nom de la base de dades', {
        defaultValue: defaultWizardValues.databaseName,
      }),
      user: await promptRequiredText(io, 'Usuari de la base de dades', {
        defaultValue: defaultWizardValues.databaseUser,
      }),
      password: await promptRequiredText(io, 'Contrasenya de la base de dades', { secret: true }),
      ssl: defaultWizardValues.databaseSsl,
    },
    adminElevation: {
      password: await promptRequiredText(io, 'Contrasenya d elevacio administrativa', {
        secret: true,
      }),
    },
    bootstrap: {
      firstAdmin: {
        telegramUserId: await promptInteger(io, 'Telegram user ID del primer administrador', {
          min: 1,
          max: 2147483647,
          guidance:
            'Introdueix el Telegram user ID numeric del primer administrador. No s inferira automaticament.',
        }),
        username: await promptOptionalText(io, 'Username del primer administrador'),
        displayName: await promptRequiredText(io, 'Nom visible del primer administrador'),
      },
    },
    notifications: {
      defaults: {
        groupAnnouncementsEnabled: await promptBoolean(io, 'Activar anuncis de grup per defecte', {
          defaultValue: defaultWizardValues.groupAnnouncementsEnabled,
        }),
        eventRemindersEnabled: await promptBoolean(
          io,
          'Activar recordatoris d esdeveniments per defecte',
          {
            defaultValue: defaultWizardValues.eventRemindersEnabled,
          },
        ),
        eventReminderLeadHours: await promptInteger(io, 'Antelacio dels recordatoris en hores', {
          defaultValue: String(defaultWizardValues.eventReminderLeadHours),
          min: 1,
          max: 168,
        }),
      },
    },
    featureFlags: {
      bootstrapWizard: true,
    },
  });

  io.writeLine('');
  io.writeLine('Resum de la configuracio recollida');
  io.writeLine(renderConfigSummary(candidate));
  io.writeLine('');

  const confirmed = await io.confirm('Vols acceptar aquesta configuracio?');

  if (!confirmed) {
    io.writeLine('Configuracio descartada. No s ha persistit cap canvi.');
    return null;
  }

  io.writeLine('Configuracio validada en memoria. La persistencia a disc es gestionara en el pas seguent.');
  return candidate;
}

async function promptRequiredText(
  io: WizardIo,
  label: string,
  options: { defaultValue?: string; secret?: boolean } = {},
): Promise<string> {
  while (true) {
    const value = (await io.prompt({
      label,
      ...toPromptOptionFields(options.defaultValue, options.secret),
    })).trim();

    const finalValue = value || options.defaultValue;

    if (finalValue && finalValue.trim().length > 0) {
      return finalValue.trim();
    }

    io.writeLine('El valor no pot quedar buit.');
  }
}

async function promptOptionalText(io: WizardIo, label: string): Promise<string | undefined> {
  const value = (await io.prompt({ label })).trim();
  return value.length > 0 ? value : undefined;
}

async function promptInteger(
  io: WizardIo,
  label: string,
  options: {
    defaultValue?: string;
    min: number;
    max: number;
    guidance?: string;
  },
): Promise<number> {
  if (options.guidance) {
    io.writeLine(options.guidance);
  }

  while (true) {
    const rawValue = (await io.prompt({
      label,
      ...toPromptOptionFields(options.defaultValue),
    })).trim();
    const finalValue = rawValue || options.defaultValue;

    if (!finalValue) {
      io.writeLine(`Introdueix un numero enter entre ${options.min} i ${options.max}.`);
      continue;
    }

    if (!/^[-]?\d+$/.test(finalValue)) {
      io.writeLine('Introdueix un numero enter valid.');
      continue;
    }

    const parsedValue = Number(finalValue);

    if (parsedValue < options.min || parsedValue > options.max) {
      io.writeLine(`Introdueix un numero enter entre ${options.min} i ${options.max}.`);
      continue;
    }

    return parsedValue;
  }
}

async function promptBoolean(
  io: WizardIo,
  label: string,
  options: { defaultValue: boolean },
): Promise<boolean> {
  const defaultText = options.defaultValue ? 'si' : 'no';

  while (true) {
    const value = (await io.prompt({ label, defaultValue: defaultText })).trim().toLowerCase();
    const finalValue = value || defaultText;

    if (['si', 's', 'yes', 'y'].includes(finalValue)) {
      return true;
    }

    if (['no', 'n'].includes(finalValue)) {
      return false;
    }

    io.writeLine('Respon si o no.');
  }
}

function renderConfigSummary(config: BootstrapConfigCandidate): string {
  return [
    `- Schema version: ${config.schemaVersion}`,
    `- Nom public del bot: ${config.bot.publicName}`,
    `- Nom del club: ${config.bot.clubName}`,
    `- Token de Telegram: ${maskSecret(config.telegram.token)}`,
    `- Base de dades: ${config.database.user}@${config.database.host}:${config.database.port}/${config.database.name}`,
    `- Contrasenya de base de dades: ${maskSecret(config.database.password)}`,
    `- SSL de PostgreSQL: ${config.database.ssl ? 'si' : 'no'}`,
    `- Contrasenya admin: ${maskSecret(config.adminElevation.password)}`,
    `- Primer administrador ID: ${config.bootstrap.firstAdmin.telegramUserId}`,
    `- Primer administrador username: ${config.bootstrap.firstAdmin.username ?? '(no indicat)'}`,
    `- Primer administrador nom visible: ${config.bootstrap.firstAdmin.displayName}`,
    `- Anuncis de grup: ${config.notifications.defaults.groupAnnouncementsEnabled ? 'activats' : 'desactivats'}`,
    `- Recordatoris d esdeveniments: ${config.notifications.defaults.eventRemindersEnabled ? 'activats' : 'desactivats'}`,
    `- Antelacio de recordatoris: ${config.notifications.defaults.eventReminderLeadHours} hores`,
  ].join('\n');
}

function maskSecret(value: string): string {
  return `[valor ocult, ${value.length} caracters]`;
}

function toPromptOptionFields(defaultValue?: string, secret?: boolean): Partial<PromptOptions> {
  return {
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(secret !== undefined ? { secret } : {}),
  };
}
