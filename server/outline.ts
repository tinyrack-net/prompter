import { z } from 'zod';

/** The parts of an Outline document the prompter uses. */
export const outlineDocumentSchema = z.object({
  id: z.string(),
  urlId: z.string(),
  title: z.string(),
  text: z.string().default(''),
  url: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
  deletedAt: z.string().nullish(),
  archivedAt: z.string().nullish(),
});

export type OutlineDocument = z.infer<typeof outlineDocumentSchema>;

const searchResultSchema = z.object({
  context: z.string().default(''),
  document: outlineDocumentSchema.pick({ id: true, urlId: true, title: true, updatedAt: true }),
});

export type OutlineSearchResult = z.infer<typeof searchResultSchema>;

export class OutlineError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OutlineError';
    this.status = status;
  }
}

export interface OutlineClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** A small client for the Outline API endpoints the prompter needs. */
export class OutlineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OutlineClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Accepts a UUID or the short urlId used in document links. */
  async getDocument(id: string): Promise<OutlineDocument> {
    const data = await this.call('documents.info', { id });
    return outlineDocumentSchema.parse(data);
  }

  async search(query: string, limit = 20): Promise<OutlineSearchResult[]> {
    const data = await this.call('documents.search', { query, limit, statusFilter: ['published'] });
    return z.array(searchResultSchema).parse(data);
  }

  /** Recently updated documents, for the launcher when no query is typed. */
  async listRecent(limit = 20): Promise<OutlineSearchResult[]> {
    const data = await this.call('documents.list', {
      limit,
      sort: 'updatedAt',
      direction: 'DESC',
      statusFilter: ['published'],
    });
    return z
      .array(searchResultSchema.shape.document)
      .parse(data)
      .map((document) => ({ context: '', document }));
  }

  /** Checks that the API key works; returns the user and workspace names. */
  async whoami(): Promise<{ user: string; team: string }> {
    const data = await this.call('auth.info', {});
    const parsed = z
      .object({ user: z.object({ name: z.string() }), team: z.object({ name: z.string() }) })
      .parse(data);
    return { user: parsed.user.name, team: parsed.team.name };
  }

  private async call(method: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
          ? json.message
          : res.statusText;
      throw new OutlineError(res.status, `${method}: ${message}`);
    }
    if (!json || typeof json !== 'object' || !('data' in json)) {
      throw new OutlineError(502, `${method}: unexpected response`);
    }
    return json.data;
  }
}

/**
 * Extracts a document reference from what a user pastes: a full Outline URL
 * (`/doc/<slug>-<urlId>`), a share-less urlId, or a UUID.
 */
export function parseDocumentRef(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(value);
  if (uuid) return uuid[0].toLowerCase();
  // Outline's urlId is 10 alphanumeric characters at the end of the slug.
  const fromPath = /\/doc\/(?:[^/?#]*-)?([A-Za-z0-9]{10})(?:[/?#]|$)/.exec(value);
  if (fromPath?.[1]) return fromPath[1];
  if (/^[A-Za-z0-9]{10}$/.test(value)) return value;
  return null;
}
