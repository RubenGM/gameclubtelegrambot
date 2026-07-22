import { createHmac, timingSafeEqual } from 'node:crypto';

export interface NotionWebhookLogger {
  info(bindings: object, message: string): void;
  warn?(bindings: object, message: string): void;
  error?(bindings: object, message: string): void;
}

export interface NotionWebhookEvent {
  id: string;
  type: string;
  timestamp: string | null;
  entity: {
    id: string;
    type: string | null;
  } | null;
  raw: Record<string, unknown>;
}

export interface NotionWebhookHandlerOptions {
  /** The verification token delivered by Notion when the subscription was created. */
  verificationToken?: string;
  onEvent(event: NotionWebhookEvent): Promise<void>;
  /** Called for the unsigned setup request. Never log this token. */
  onVerificationToken?(verificationToken: string): Promise<void> | void;
  logger?: NotionWebhookLogger;
}

export interface NotionWebhookRequest {
  rawBody: string | Uint8Array;
  signature: string | undefined;
}

export interface NotionWebhookResult {
  statusCode: 202 | 400 | 401 | 503;
  kind: 'accepted' | 'invalid_json' | 'invalid_signature' | 'missing_verification_token' | 'handler_failed' | 'verification';
}

/**
 * Validates raw Notion webhook payload bytes before JSON parsing. The caller is
 * responsible for passing the request body verbatim; re-serializing JSON changes
 * the HMAC input and must not be done.
 */
export function createNotionWebhookHandler(options: NotionWebhookHandlerOptions): {
  handle(request: NotionWebhookRequest): Promise<NotionWebhookResult>;
} {
  const verificationToken = options.verificationToken?.trim() || null;

  return {
    async handle(request: NotionWebhookRequest): Promise<NotionWebhookResult> {
      const rawBody = toBuffer(request.rawBody);
      const payload = parsePayload(rawBody);
      if (!payload) {
        options.logger?.warn?.({ notionWebhook: { reason: 'invalid_json' } }, 'Ignored invalid Notion webhook payload');
        return { statusCode: 400, kind: 'invalid_json' };
      }

      const setupToken = typeof payload.verification_token === 'string' ? payload.verification_token.trim() : '';
      if (setupToken) {
        try {
          await options.onVerificationToken?.(setupToken);
        } catch (error) {
          options.logger?.error?.({ notionWebhook: { error: errorMessage(error) } }, 'Could not record Notion webhook verification token');
          return { statusCode: 503, kind: 'handler_failed' };
        }
        // Notion asks the operator to paste this token into its developer UI.
        // Deliberately log only that it arrived, never the secret itself.
        options.logger?.info({ notionWebhook: { verification: true } }, 'Received Notion webhook verification request');
        return { statusCode: 202, kind: 'verification' };
      }

      if (!verificationToken) {
        options.logger?.error?.({ notionWebhook: { reason: 'missing_verification_token' } }, 'Notion webhook event rejected because verification is not configured');
        return { statusCode: 503, kind: 'missing_verification_token' };
      }
      if (!verifyNotionWebhookSignature(rawBody, request.signature, verificationToken)) {
        options.logger?.warn?.({ notionWebhook: { reason: 'invalid_signature' } }, 'Ignored Notion webhook with invalid signature');
        return { statusCode: 401, kind: 'invalid_signature' };
      }

      const event = parseEvent(payload);
      if (!event) {
        options.logger?.warn?.({ notionWebhook: { reason: 'invalid_event' } }, 'Ignored malformed Notion webhook event');
        return { statusCode: 400, kind: 'invalid_json' };
      }
      try {
        await options.onEvent(event);
      } catch (error) {
        options.logger?.error?.(
          { notionWebhook: { eventId: event.id, type: event.type, error: errorMessage(error) } },
          'Notion webhook event handler failed',
        );
        return { statusCode: 503, kind: 'handler_failed' };
      }
      return { statusCode: 202, kind: 'accepted' };
    },
  };
}

export function verifyNotionWebhookSignature(
  rawBody: string | Uint8Array,
  signature: string | undefined,
  verificationToken: string,
): boolean {
  if (!signature || !verificationToken) {
    return false;
  }
  const expected = createHmac('sha256', verificationToken).update(toBuffer(rawBody)).digest('hex');
  const supplied = signature.trim();
  const expectedWithPrefix = `sha256=${expected}`;
  const actual = Buffer.from(supplied, 'utf8');
  const comparison = Buffer.from(expectedWithPrefix, 'utf8');
  return actual.length === comparison.length && timingSafeEqual(actual, comparison);
}

function parsePayload(rawBody: Buffer): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEvent(raw: Record<string, unknown>): NotionWebhookEvent | null {
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (!id || !type) {
    return null;
  }
  const rawEntity = isRecord(raw.entity) ? raw.entity : null;
  const entityId = typeof rawEntity?.id === 'string' ? rawEntity.id.trim() : '';
  return {
    id,
    type,
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : null,
    entity: entityId ? { id: entityId, type: typeof rawEntity?.type === 'string' ? rawEntity.type : null } : null,
    raw,
  };
}

function toBuffer(value: string | Uint8Array): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
