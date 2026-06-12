import type { RuntimeConfig } from '../config/runtime-config.js';

export interface ResolvedLlmCommandConfig {
  enabled: boolean;
  privateFallbackEnabled: boolean;
  opencodeBin?: string | undefined;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
  maxHistory: number;
  sessionTtlMinutes: number;
  maxPromptChars: number;
  readConfidenceThreshold: number;
  writeConfidenceThreshold: number;
  dryRun: boolean;
}

export const defaultLlmCommandConfig: ResolvedLlmCommandConfig = {
  enabled: false,
  privateFallbackEnabled: true,
  model: 'openai/gpt-5.4-mini',
  reasoningEffort: 'low',
  timeoutMs: 20000,
  maxHistory: 8,
  sessionTtlMinutes: 15,
  maxPromptChars: 12000,
  readConfidenceThreshold: 0.75,
  writeConfidenceThreshold: 0.9,
  dryRun: false,
};

export function resolveLlmCommandConfig(config: RuntimeConfig): ResolvedLlmCommandConfig {
  const input = config.llmCommands;
  return {
    ...defaultLlmCommandConfig,
    ...input,
  };
}
