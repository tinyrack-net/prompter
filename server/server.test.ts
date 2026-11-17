import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.ts';
import { DocumentHub, type HubEvent } from './hub.ts';
import { OutlineClient, type OutlineDocument, parseDocumentRef } from './outline.ts';
import { interpretDelivery, verifyOutlineSignature } from './webhook.ts';

const SECRET = 'test-secret';
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function sign(body: string, timestamp = Date.now(), secret = SECRET): string {
  const s = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},s=${s}`;
}

function doc(overrides: Partial<OutlineDocument> = {}): OutlineDocument {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    urlId: 'AbCdEfGhIj',
    title: 'Script',
    text: '# Intro\n\nHello everyone.',
    url: '/doc/script-AbCdEfGhIj',
    revision: 1,
    updatedAt: '2026-11-15T00:00:00.000Z',
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** An in-memory Outline with a mutable document store. */
function fakeOutline(initial: OutlineDocument[]) {
  const store = new Map(initial.map((d) => [d.id, d]));
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = String(input).split('/api/')[1] ?? '';
    calls.push(method);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (method === 'documents.info') {
      const found = [...store.values()].find((d) => d.id === body.id || d.urlId === body.id);
      return found
        ? Response.json({ data: found })
        : Response.json({ message: 'Not found' }, { status: 404 });
    }
    if (method === 'documents.search') {
      const data = [...store.values()]
        .filter((d) => d.title.toLowerCase().includes(String(body.query).toLowerCase()))
        .map((d) => ({ context: `<b>${d.title}</b> context`, document: d }));
      return Response.json({ data });
    }
    if (method === 'documents.list') return Response.json({ data: [...store.values()] });
    return Response.json({ message: 'unknown' }, { status: 400 });
  };
  const client = new OutlineClient({
    baseUrl: 'https://outline.test',
    apiKey: 'k',
    fetch: fetchImpl,
  });
  return { store, calls, client };
}

function setup(docs = [doc()], graceMs = 0) {
  const outline = fakeOutline(docs);
  const hub = new DocumentHub(outline.client, 'https://outline.test', logger, { graceMs });
  const app = createApp({
    outline: outline.client,
    hub,
    webhookSecret: SECRET,
    logger,
    keepAliveMs: 50,
  });
  return { ...outline, hub, app };
}

describe('parseDocumentRef', () => {
  it('accepts Outline URLs, urlIds and UUIDs', () => {
    expect(parseDocumentRef('https://notes.example.com/doc/my-script-AbCdEfGhIj')).toBe(
      'AbCdEfGhIj',
    );
    expect(parseDocumentRef('https://notes.example.com/doc/my-script-AbCdEfGhIj/edit')).toBe(
      'AbCdEfGhIj',
    );
    expect(parseDocumentRef('AbCdEfGhIj')).toBe('AbCdEfGhIj');
    expect(parseDocumentRef(' 11111111-2222-3333-4444-555555555555 ')).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(parseDocumentRef('teleprompter tips')).toBeNull();
    expect(parseDocumentRef('')).toBeNull();
  });
});

describe('verifyOutlineSignature', () => {
  const body = '{"event":"documents.update"}';

  it('accepts a valid signature and rejects tampering', () => {
    expect(verifyOutlineSignature(sign(body), body, SECRET)).toBe(true);
    expect(verifyOutlineSignature(sign(body), `${body} `, SECRET)).toBe(false);
    expect(verifyOutlineSignature(sign(body, Date.now(), 'other'), body, SECRET)).toBe(false);
    expect(verifyOutlineSignature(undefined, body, SECRET)).toBe(false);
    expect(verifyOutlineSignature('garbage', body, SECRET)).toBe(false);
  });

  it('rejects stale deliveries', () => {
    const old = Date.now() - 10 * 60 * 1000;
    expect(verifyOutlineSignature(sign(body, old), body, SECRET)).toBe(false);
  });
});

describe('interpretDelivery', () => {
  it('uses the document from the payload when it is complete', () => {
    const action = interpretDelivery({
      event: 'documents.update',
      payload: { id: 'x', model: doc() },
    });
    expect(action.kind).toBe('document');
  });

  it('asks for a refetch when the payload has no usable document', () => {
    expect(
      interpretDelivery({ event: 'documents.update', payload: { id: 'x', model: null } }),
    ).toEqual({ kind: 'refresh', id: 'x' });
  });

  it('maps removals and ignores unrelated events', () => {
    expect(interpretDelivery({ event: 'documents.delete', payload: { id: 'x' } })).toEqual({
      kind: 'removed',
      id: 'x',
    });
    expect(interpretDelivery({ event: 'users.create', payload: { id: 'x' } }).kind).toBe('ignored');
    expect(interpretDelivery('nonsense').kind).toBe('ignored');
  });
});

describe('DocumentHub', () => {
  it('fetches once, converts Markdown, and resolves urlIds to the same document', async () => {
    const { hub, calls } = setup();
    const byUrlId = await hub.get('AbCdEfGhIj');
    expect(byUrlId.script).toBe('Hello everyone.');
    expect(byUrlId.outlineUrl).toBe('https://outline.test/doc/script-AbCdEfGhIj');
    hub.subscribe(byUrlId.id, () => {});
    await hub.get(byUrlId.id);
    await hub.get('AbCdEfGhIj');
    expect(calls.filter((c) => c === 'documents.info')).toHaveLength(1);
  });

  it('pushes newer revisions to viewers and ignores older or unwatched ones', async () => {
    const { hub } = setup();
    const first = await hub.get(doc().id);
    const events: HubEvent[] = [];
    hub.subscribe(first.id, (e) => events.push(e));

    hub.applyWebhookDocument(doc({ revision: 2, text: 'Changed text.' }));
    hub.applyWebhookDocument(doc({ revision: 1, text: 'Stale text.' }));
    hub.applyWebhookDocument(doc({ id: 'unwatched', revision: 9 }));
    expect(await hub.get('unwatched').catch(() => null)).toBeNull();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'document',
      document: { revision: 2, script: 'Changed text.' },
    });
  });

  it('keeps edits made between server rendering and the browser connecting', async () => {
    vi.useFakeTimers();
    try {
      const { hub, calls } = setup([doc()], 60_000);
      await hub.get(doc().id);
      // A webhook arrives before any viewer subscribes.
      hub.applyWebhookDocument(doc({ revision: 2, text: 'Edited early.' }));
      expect((await hub.get(doc().id)).script).toBe('Edited early.');

      // After the grace period an unwatched copy is dropped and fetched fresh.
      vi.advanceTimersByTime(60_000);
      await hub.get(doc().id);
      expect(calls.filter((c) => c === 'documents.info')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies viewers when a document is removed and forgets unwatched copies', async () => {
    const { hub, calls } = setup();
    const d = await hub.get(doc().id);
    const events: HubEvent[] = [];
    const unsubscribe = hub.subscribe(d.id, (e) => events.push(e));
    hub.applyWebhookDocument(doc({ revision: 2, deletedAt: '2026-11-15T01:00:00Z' }));
    expect(events).toEqual([{ type: 'deleted', id: d.id }]);

    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await hub.get(d.id);
    expect(calls.filter((c) => c === 'documents.info')).toHaveLength(2);
  });
});

describe('HTTP API', () => {
  it('rejects unsigned webhooks and applies signed ones', async () => {
    const { app, hub } = setup();
    const d = await hub.get(doc().id);
    const events: HubEvent[] = [];
    hub.subscribe(d.id, (e) => events.push(e));

    const body = JSON.stringify({
      event: 'documents.update',
      payload: { id: d.id, model: doc({ revision: 3, text: 'From webhook.' }) },
    });
    const unsigned = await app.request('/api/webhooks/outline', { method: 'POST', body });
    expect(unsigned.status).toBe(401);
    expect(events).toHaveLength(0);

    const signed = await app.request('/api/webhooks/outline', {
      method: 'POST',
      body,
      headers: { 'Outline-Signature': sign(body) },
    });
    expect(signed.status).toBe(204);
    expect(events[0]).toMatchObject({ document: { revision: 3, script: 'From webhook.' } });
  });

  it('searches, and opens pasted links directly', async () => {
    const { app } = setup();
    const search = await (await app.request('/api/documents?q=scr')).json();
    expect(search).toMatchObject({
      direct: false,
      results: [{ title: 'Script', context: 'Script context' }],
    });

    const pasted = await (
      await app.request(`/api/documents?q=${encodeURIComponent('https://x/doc/script-AbCdEfGhIj')}`)
    ).json();
    expect(pasted).toMatchObject({ direct: true, results: [{ id: doc().id }] });

    const recent = await (await app.request('/api/documents')).json();
    expect(recent.results).toHaveLength(1);
  });

  it('maps Outline errors to HTTP statuses', async () => {
    const { app } = setup();
    expect((await app.request('/api/documents/missing')).status).toBe(404);
    expect((await app.request('/api/nope')).status).toBe(404);
  });

  it('streams the current document and later updates over SSE', async () => {
    const { app, hub } = setup();
    const res = await app.request(`/api/documents/${doc().id}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${needle}`);
        text += decoder.decode(value);
      }
    };

    await readUntil('"revision":1');
    hub.applyWebhookDocument(doc({ revision: 2, text: 'Live!' }));
    await readUntil('"revision":2');
    expect(text).toContain('"script":"Live!"');
    await readUntil(': keep-alive');

    await reader.cancel();
    await vi.waitFor(() => expect(hub.viewerCount(doc().id)).toBe(0));
  });
});
