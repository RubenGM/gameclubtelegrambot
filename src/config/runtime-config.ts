import { z } from 'zod';

export const botLanguageValues = ['ca', 'es', 'en'] as const;

const botLanguageSchema = z.enum(botLanguageValues);
const telegramButtonStyleSchema = z.enum(['primary', 'success', 'danger']);
const telegramButtonAppearanceSchema = z
  .object({
    style: telegramButtonStyleSchema.optional(),
    iconCustomEmojiId: z.string().trim().min(1).optional(),
  })
  .strict();
const telegramButtonAppearanceByRoleSchema = z
  .object({
    primary: telegramButtonAppearanceSchema.optional(),
    secondary: telegramButtonAppearanceSchema.optional(),
    success: telegramButtonAppearanceSchema.optional(),
    danger: telegramButtonAppearanceSchema.optional(),
    navigation: telegramButtonAppearanceSchema.optional(),
    help: telegramButtonAppearanceSchema.optional(),
  })
  .strict()
  .optional();

const booleanFromEnvSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const integerFromEnvSchema = z.coerce.number().int();
const numberFromEnvSchema = z.coerce.number();

const telegramLocalBotApiSchema = z
  .object({
    enabled: booleanFromEnvSchema.default(false),
    baseUrl: z.string().trim().url().default('http://127.0.0.1:8081'),
    apiId: integerFromEnvSchema.min(1).optional(),
    apiHash: z.string().trim().min(1).optional(),
    dataDir: z.string().trim().min(1).default('/var/lib/gameclubtelegrambot/telegram-bot-api'),
  })
  .superRefine((value, context) => {
    if (!value.enabled) {
      return;
    }

    if (value.apiId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiId'],
        message: 'Required when telegram.localBotApi.enabled is true',
      });
    }

    if (!value.apiHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiHash'],
        message: 'Required when telegram.localBotApi.enabled is true',
      });
    }
  })
  .optional();

const defaultNotificationDefaults = {
  groupAnnouncementsEnabled: true,
  eventRemindersEnabled: true,
  eventReminderLeadHours: 24,
} as const;

const notionConfigSchema = z
  .object({
    enabled: booleanFromEnvSchema.default(false),
    credentialEncryptionKey: z.string().trim().min(32).optional(),
  })
  .superRefine((value, context) => {
    if (value.enabled && !value.credentialEncryptionKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credentialEncryptionKey'],
        message: 'Required when notion.enabled is true',
      });
    }
  })
  .optional();

export const runtimeConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  bot: z.object({
    publicName: z.string().trim().min(1),
    clubName: z.string().trim().min(1),
    language: botLanguageSchema.default('ca'),
    iconPath: z.string().trim().min(1).optional(),
  }),
  telegram: z.object({
    token: z.string().trim().min(1),
    buttonAppearance: telegramButtonAppearanceByRoleSchema,
    localBotApi: telegramLocalBotApiSchema,
  }),
  bgg: z
    .object({
      apiKey: z.string().trim().min(1).optional(),
    })
    .optional(),
  translation: z
    .object({
      deeplApiKey: z.string().trim().min(1).optional(),
      deeplApiUrl: z.string().trim().url().optional(),
    })
    .optional(),
  notion: notionConfigSchema,
  database: z.object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    name: z.string().trim().min(1),
    user: z.string().trim().min(1),
    password: z.string().trim().min(1),
    ssl: z.boolean(),
  }),
  adminElevation: z.object({
    passwordHash: z.string().trim().min(1),
  }),
  httpServer: z
    .object({
      enabled: z.boolean().default(true),
      host: z.string().trim().min(1).default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(8787),
      feedbackFile: z.string().trim().min(1).default('data/feedback.jsonl'),
      sessionSecret: z.string().trim().min(16).optional(),
    })
    .optional(),
  bootstrap: z.object({
    firstAdmin: z.object({
      telegramUserId: z.number().int().positive(),
      username: z.string().trim().min(1).optional(),
      displayName: z.string().trim().min(1),
    }),
  }),
  notifications: z
    .object({
      defaults: z
        .object({
          groupAnnouncementsEnabled: z.boolean().default(true),
          eventRemindersEnabled: z.boolean().default(true),
          eventReminderLeadHours: z.number().int().min(1).max(168).default(24),
        })
        .default(defaultNotificationDefaults),
    })
    .default({ defaults: defaultNotificationDefaults }),
  llmCommands: z
    .object({
      enabled: booleanFromEnvSchema.default(false),
      privateFallbackEnabled: booleanFromEnvSchema.default(true),
      provider: z.enum(['codex', 'opencode']).default('codex'),
      opencodeBin: z.string().trim().min(1).optional(),
      codexBin: z.string().trim().min(1).optional(),
      model: z.string().trim().min(1).default('gpt-5.4-mini'),
      reasoningEffort: z.string().trim().min(1).default('low'),
      timeoutMs: integerFromEnvSchema.min(1000).max(120000).default(60000),
      maxHistory: integerFromEnvSchema.min(0).max(50).default(8),
      sessionTtlMinutes: integerFromEnvSchema.min(1).max(120).default(15),
      maxPromptChars: integerFromEnvSchema.min(1000).max(100000).default(12000),
      readConfidenceThreshold: numberFromEnvSchema.min(0).max(1).default(0.75),
      writeConfidenceThreshold: numberFromEnvSchema.min(0).max(1).default(0.9),
      dryRun: booleanFromEnvSchema.default(false),
    })
    .optional(),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const defaultRuntimeConfigPath = 'config/runtime.json';
