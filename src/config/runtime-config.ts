import { z } from 'zod';

export const runtimeConfigSchema = z.object({
  bot: z.object({
    publicName: z.string().trim().min(1),
    clubName: z.string().trim().min(1),
    iconPath: z.string().trim().min(1).optional(),
  }),
  telegram: z.object({
    token: z.string().trim().min(1),
  }),
  database: z.object({
    host: z.string().trim().min(1),
    port: z.number().int().min(1).max(65535),
    name: z.string().trim().min(1),
    user: z.string().trim().min(1),
    password: z.string().trim().min(1),
    ssl: z.boolean(),
  }),
  adminElevation: z.object({
    password: z.string().trim().min(1),
  }),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const defaultRuntimeConfigPath = 'config/runtime.json';
