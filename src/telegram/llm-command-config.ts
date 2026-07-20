import type { RuntimeConfig } from '../config/runtime-config.js';

export interface ResolvedLlmCommandConfig {
  enabled: boolean;
  privateFallbackEnabled: boolean;
  provider: 'codex' | 'opencode';
  opencodeBin?: string | undefined;
  codexBin?: string | undefined;
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
  provider: 'codex',
  codexBin: './scripts/codex-cawa.sh',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  timeoutMs: 60000,
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
