import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * A minimal stand-in for Outline used by E2E tests and local development.
 *
 * API (Outline-compatible):  POST /api/documents.info | documents.search | documents.list | auth.info
 * Test control:              POST /__test/documents   { id?, title, text }   create or replace
 *                            POST /__test/edit        { id, text?, title? }  bump revision and
 *                                                     deliver a signed webhook to WEBHOOK_URL
 *                            POST /__test/delete      { id }                 delete + webhook
 */

interface Doc {
  id: string;
  urlId: string;
  title: string;
  text: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
}

const PORT = Number(process.env.FAKE_OUTLINE_PORT ?? 4320);
const API_KEY = process.env.FAKE_OUTLINE_API_KEY ?? 'test-api-key';
const WEBHOOK_URL =
  process.env.FAKE_OUTLINE_WEBHOOK_URL ?? 'http://localhost:4319/api/webhooks/outline';
const WEBHOOK_SECRET = process.env.FAKE_OUTLINE_WEBHOOK_SECRET ?? 'test-webhook-secret';

const docs = new Map<string, Doc>();
// Never reset: like real Outline, IDs are never reused, even across test resets.
let seq = 0;

function urlIdFor(n: number): string {
  return `Doc${String(n).padStart(7, '0')}`;
}
// Unique per run, so restarting the fake never collides with the app's cache.
const runId = Date.now().toString(16).slice(-8).padStart(8, '0');

function present(doc: Doc) {
  const slug =
    doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled';
  return {
    id: doc.id,
    urlId: doc.urlId,
    title: doc.title,
    text: doc.text,
    url: `/doc/${slug}-${doc.urlId}`,
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
    archivedAt: null,
  };
}

function upsert(input: { id?: string; title: string; text: string }): Doc {
  const existing = input.id ? docs.get(input.id) : undefined;
  if (existing) {
    existing.title = input.title;
    existing.text = input.text;
    existing.revision += 1;
    existing.updatedAt = new Date().toISOString();
    existing.deletedAt = null;
    return existing;
  }
  seq += 1;
  const id = input.id ?? `${runId}-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const doc: Doc = {
    id,
    urlId: urlIdFor(seq),
    title: input.title,
    text: input.text,
    revision: 1,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  docs.set(id, doc);
  return doc;
}

function find(ref: unknown): Doc | undefined {
  if (typeof ref !== 'string') return undefined;
  const doc = docs.get(ref) ?? [...docs.values()].find((d) => d.urlId === ref);
  return doc && !doc.deletedAt ? doc : undefined;
}

async function deliver(event: string, doc: Doc): Promise<number> {
  const body = JSON.stringify({
    id: `delivery-${Date.now()}`,
    actorId: 'user',
    webhookSubscriptionId: 'sub',
    createdAt: new Date().toISOString(),
    event,
    payload: { id: doc.id, model: present(doc) },
  });
  const t = Date.now();
  const s = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Outline-Signature': `t=${t},s=${s}` },
    body,
  });
  return res.status;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const path = req.url ?? '';
    const body = req.method === 'POST' ? await readJson(req) : {};

    if (path.startsWith('/__test/')) {
      if (path === '/__test/health') return send(res, 200, { ok: true });
      if (path === '/__test/reset') {
        docs.clear();
        return send(res, 200, { ok: true });
      }
      if (path === '/__test/documents') {
        const doc = upsert({
          id: typeof body.id === 'string' ? body.id : undefined,
          title: String(body.title ?? 'Untitled'),
          text: String(body.text ?? ''),
        });
        return send(res, 200, present(doc));
      }
      const doc = docs.get(String(body.id));
      if (!doc) return send(res, 404, { message: 'no such document' });
      if (path === '/__test/edit') {
        upsert({
          id: doc.id,
          title: typeof body.title === 'string' ? body.title : doc.title,
          text: typeof body.text === 'string' ? body.text : doc.text,
        });
        const status = body.webhook === false ? 0 : await deliver('documents.update', doc);
        return send(res, 200, { ...present(doc), webhookStatus: status });
      }
      if (path === '/__test/delete') {
        doc.deletedAt = new Date().toISOString();
        doc.revision += 1;
        return send(res, 200, { webhookStatus: await deliver('documents.delete', doc) });
      }
      return send(res, 404, { message: 'unknown test route' });
    }

    if (req.headers.authorization !== `Bearer ${API_KEY}`) {
      return send(res, 401, { ok: false, message: 'Authentication required' });
    }
    switch (path) {
      case '/api/auth.info':
        return send(res, 200, {
          data: { user: { name: 'Test User' }, team: { name: 'Test Team' } },
        });
      case '/api/documents.info': {
        const doc = find(body.id);
        return doc
          ? send(res, 200, { data: present(doc) })
          : send(res, 404, { message: 'Not found' });
      }
      case '/api/documents.search': {
        const q = String(body.query ?? '').toLowerCase();
        const data = [...docs.values()]
          .filter((d) => !d.deletedAt && (d.title + d.text).toLowerCase().includes(q))
          .map((d) => ({ context: d.text.slice(0, 80), document: present(d) }));
        return send(res, 200, { data });
      }
      case '/api/documents.list': {
        const data = [...docs.values()]
          .filter((d) => !d.deletedAt)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(present);
        return send(res, 200, { data });
      }
      default:
        return send(res, 404, { message: 'Not found' });
    }
  } catch (err) {
    send(res, 500, { message: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`fake outline listening on ${PORT}`);
});
