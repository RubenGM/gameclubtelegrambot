import { z } from 'zod';

import { llmCommandIntentValues } from './llm-command-actions.js';

export const llmCommandActionTypeValues = [
  'answer_directly',
  'ask_clarification',
  'request_confirmation',
  'call_internal_handler',
  'dispatch_command',
  'unsupported',
] as const;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const llmCommandDecisionSchema = z
  .object({
    version: z.literal(1),
    language: z.enum(['ca', 'es', 'en']).catch('es'),
    intent: z.enum(llmCommandIntentValues),
    confidence: z.number().min(0).max(1),
	    reply: z
	      .object({
	        text: z.string().trim().min(1),
	        sendNow: z.boolean(),
	      })
	      .strict(),
	    progress: z
	      .object({
	        messages: z.array(z.string().trim().min(1).max(180)).max(4).default([]),
	      })
	      .strict()
	      .default({ messages: [] }),
	    needsClarification: z.boolean(),
    clarification: z
      .object({
        question: z.string().trim().min(1),
        expectedFields: z.array(z.string().trim().min(1)).default([]),
        knownParams: jsonObjectSchema.default({}),
      })
      .strict()
      .nullable(),
    requiresConfirmation: z.boolean(),
    confirmation: z
      .object({
        text: z.string().trim().min(1),
        params: jsonObjectSchema.default({}),
      })
      .strict()
      .nullable(),
    action: z
      .object({
        type: z.enum(llmCommandActionTypeValues),
        name: z.string().trim().min(1),
        params: jsonObjectSchema.default({}),
      })
      .strict(),
    safety: z
      .object({
        requiresApprovedMember: z.boolean(),
        requiresAdmin: z.boolean(),
        risk: z.enum(['read_only', 'write', 'admin', 'unknown']),
        publicSideEffect: z.boolean(),
        destructive: z.boolean(),
        requiresPrivateChat: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.needsClarification && value.clarification === null) {
      context.addIssue({
        code: 'custom',
        path: ['clarification'],
        message: 'clarification is required when needsClarification is true',
      });
    }
    if (value.requiresConfirmation && value.confirmation === null) {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: 'confirmation is required when requiresConfirmation is true',
      });
    }
  });

export type LlmCommandDecision = z.infer<typeof llmCommandDecisionSchema>;
export type LlmCommandActionType = typeof llmCommandActionTypeValues[number];

export class LlmCommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmCommandParseError';
  }
}

export function parseLlmCommandDecisionJson(text: string): LlmCommandDecision {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown parse error';
    throw new LlmCommandParseError(`LLM command output is not valid JSON: ${reason}`);
  }

  const result = llmCommandDecisionSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new LlmCommandParseError(`LLM command JSON does not match the contract: ${details}`);
  }

  return result.data;
}
