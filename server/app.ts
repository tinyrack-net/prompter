import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { DocumentHub, HubEvent } from './hub.ts';
import { type OutlineClient, OutlineError, parseDocumentRef } from './outline.ts';
import { interpretDelivery, verifyOutlineSignature } from './webhook.ts';

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface AppDeps {
  outline: OutlineClient;
  hub: DocumentHub;
  webhookSecret: string;
  logger: Logger;
  /** Handles everything that is not an API route (the React Router app). */
  frontend?: (request: Request) => Promise<Response>;
  /** Interval of SSE keep-alive comments, so proxies do not drop idle streams. */
  keepAliveMs?: number;
}

function outlineErrorStatus(err: unknown): 400 | 403 | 404 | 502 {
  if (err instanceof OutlineError) {
    if (err.status === 400) return 400;
    if (err.status === 401 || err.status === 403) return 403;
    if (err.status === 404) return 404;
  }
  return 502;
}

export function createApp(deps: AppDeps): Hono {
  const { outline, hub, logger } = deps;
  const keepAliveMs = deps.keepAliveMs ?? 25_000;
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.get('/api/documents', async (c) => {
    const query = (c.req.query('q') ?? '').trim();
    try {
      // A pasted link or ID resolves to that document directly.
      const ref = query ? parseDocumentRef(query) : null;
      if (ref) {
        const doc = await hub.get(ref).catch(() => null);
        if (doc) {
          return c.json({
            results: [{ id: doc.id, title: doc.title, updatedAt: doc.updatedAt, context: '' }],
            direct: true,
          });
        }
      }
      const results = query ? await outline.search(query) : await outline.listRecent();
      return c.json({
        results: results.map((r) => ({
          id: r.document.id,
          title: r.document.title,
          updatedAt: r.document.updatedAt,
          context: r.context.replace(/<\/?b>/g, ''),
        })),
        direct: false,
      });
    } catch (err) {
      logger.warn({ err }, 'document search failed');
      return c.json({ error: 'search_failed' }, outlineErrorStatus(err));
    }
  });

  app.get('/api/documents/:id', async (c) => {
    try {
      return c.json(await hub.get(c.req.param('id')));
    } catch (err) {
      return c.json({ error: 'document_unavailable' }, outlineErrorStatus(err));
    }
  });

  /** Server-sent events: the current document, then every change. */
  app.get('/api/documents/:id/events', async (c) => {
    let doc: Awaited<ReturnType<DocumentHub['get']>>;
    try {
      doc = await hub.get(c.req.param('id'));
    } catch (err) {
      return c.json({ error: 'document_unavailable' }, outlineErrorStatus(err));
    }
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const queue: HubEvent[] = [{ type: 'document', document: doc }];
      let wake: (() => void) | null = null;
      const unsubscribe = hub.subscribe(doc.id, (event) => {
        queue.push(event);
        wake?.();
      });
      // The document may have changed between fetching and subscribing.
      const latest = await hub.get(doc.id).catch(() => doc);
      if (latest.revision > doc.revision) queue.push({ type: 'document', document: latest });

      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      try {
        while (!stream.aborted) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
            continue;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, keepAliveMs);
          });
          wake = null;
          if (queue.length === 0 && !stream.aborted) await stream.write(': keep-alive\n\n');
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.post('/api/webhooks/outline', async (c) => {
    const body = await c.req.text();
    if (!verifyOutlineSignature(c.req.header('outline-signature'), body, deps.webhookSecret)) {
      logger.warn({}, 'rejected webhook with invalid signature');
      return c.json({ error: 'invalid_signature' }, 401);
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const action = interpretDelivery(json);
    switch (action.kind) {
      case 'document':
        hub.applyWebhookDocument(action.document);
        break;
      case 'refresh':
        void hub.refresh(action.id);
        break;
      case 'removed':
        hub.handleRemoved(action.id);
        break;
      case 'ignored':
        break;
    }
    return c.body(null, 204);
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  if (deps.frontend) {
    const frontend = deps.frontend;
    app.all('*', (c) => frontend(c.req.raw));
  }

  return app;
}
