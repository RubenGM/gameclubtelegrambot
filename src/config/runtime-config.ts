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

const defaultNotificationDefaults = {
  groupAnnouncementsEnabled: true,
  eventRemindersEnabled: true,
  eventReminderLeadHours: 24,
} as const;

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
  }),
  bgg: z
    .object({
      apiKey: z.string().trim().min(1).optional(),
    })
    .optional(),
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
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const defaultRuntimeConfigPath = 'config/runtime.json';
