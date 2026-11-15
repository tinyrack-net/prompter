import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { outlineDocumentSchema } from './outline.ts';

/** Deliveries older than this are rejected to limit replay. */
const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Verifies an `Outline-Signature: t=<ms>,s=<hex>` header. Outline signs
 * `${timestamp}.${body}` with HMAC-SHA256 using the subscription secret.
 */
export function verifyOutlineSignature(
  header: string | undefined,
  body: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('s');
  if (!Number.isFinite(timestamp) || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  if (Math.abs(now - timestamp) > MAX_AGE_MS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Events that change what a viewer of the document should see. */
const CONTENT_EVENTS = new Set([
  'documents.update',
  'documents.title_change',
  'documents.publish',
  'documents.restore',
  'documents.unarchive',
]);
const REMOVAL_EVENTS = new Set([
  'documents.delete',
  'documents.permanent_delete',
  'documents.archive',
  'documents.unpublish',
]);

const deliverySchema = z.object({
  event: z.string(),
  payload: z.object({
    id: z.string(),
    model: z.unknown().nullish(),
  }),
});

export type WebhookAction =
  | { kind: 'document'; document: z.infer<typeof outlineDocumentSchema> }
  | { kind: 'refresh'; id: string }
  | { kind: 'removed'; id: string }
  | { kind: 'ignored' };

/** Interprets a verified Outline webhook delivery. */
export function interpretDelivery(body: unknown): WebhookAction {
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) return { kind: 'ignored' };
  const { event, payload } = parsed.data;

  if (REMOVAL_EVENTS.has(event)) return { kind: 'removed', id: payload.id };
  if (!CONTENT_EVENTS.has(event)) return { kind: 'ignored' };

  const model = outlineDocumentSchema.safeParse(payload.model);
  return model.success
    ? { kind: 'document', document: model.data }
    : { kind: 'refresh', id: payload.id };
}
