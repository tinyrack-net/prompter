import { markdownToScript } from '../core/markdown.ts';
import type { OutlineClient, OutlineDocument } from './outline.ts';

/** What a browser receives for an open document. */
export interface PrompterDocument {
  id: string;
  urlId: string;
  title: string;
  /** Plain prompter text derived from the Markdown. */
  script: string;
  revision: number;
  updatedAt: string;
  /** Link back to the document in Outline. */
  outlineUrl: string;
}

export type HubEvent =
  | { type: 'document'; document: PrompterDocument }
  | { type: 'deleted'; id: string };

type Listener = (event: HubEvent) => void;

interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/**
 * Keeps the latest version of every document someone has open and pushes
 * changes to those viewers. Outline webhooks drive updates; nothing polls.
 * A document that was just fetched (e.g. for server rendering) is tracked for
 * a grace period, so edits made before the browser connects are not lost.
 *
 * Documents are keyed by Outline's UUID. Viewers may open a document by its
 * short urlId, which is resolved to the UUID on first fetch.
 */
export class DocumentHub {
  private readonly documents = new Map<string, PrompterDocument>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly aliases = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<PrompterDocument>>();
  /** Copies with no viewer are kept this long, so a page that is still connecting does not miss edits. */
  private readonly graceMs: number;
  private readonly expiry = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly outline: OutlineClient,
    private readonly outlinePublicUrl: string,
    private readonly logger: Logger,
    options: { graceMs?: number } = {},
  ) {
    this.graceMs = options.graceMs ?? 60_000;
  }

  /** Returns the cached document or fetches it from Outline. */
  async get(ref: string): Promise<PrompterDocument> {
    const id = this.aliases.get(ref) ?? ref;
    const cached = this.documents.get(id);
    if (cached) return cached;
    return this.fetch(ref);
  }

  /** Subscribes to changes of a document; returns an unsubscribe function. */
  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    this.cancelExpiry(id);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(id);
        this.scheduleExpiry(id);
      }
    };
  }

  viewerCount(id: string): number {
    return this.listeners.get(id)?.size ?? 0;
  }

  /**
   * Applies a document from an Outline webhook. Webhook payloads carry the
   * full document, so no extra API call is needed. Only documents someone is
   * viewing are kept.
   */
  applyWebhookDocument(doc: OutlineDocument): void {
    if (!this.isTracked(doc.id)) return;
    if (doc.deletedAt || doc.archivedAt) {
      this.handleRemoved(doc.id);
      return;
    }
    this.publish(this.toPrompter(doc), 'webhook');
  }

  /** A document was deleted or archived in Outline. */
  handleRemoved(id: string): void {
    this.documents.delete(id);
    this.emit(id, { type: 'deleted', id });
  }

  /**
   * Refetches a document someone is viewing, e.g. when a webhook arrives
   * without a usable document body.
   */
  async refresh(id: string): Promise<void> {
    if (!this.isTracked(id)) return;
    try {
      await this.fetch(id);
    } catch (err) {
      this.logger.warn({ err, id }, 'refresh failed');
    }
  }

  private async fetch(ref: string): Promise<PrompterDocument> {
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    const promise = (async () => {
      const doc = this.toPrompter(await this.outline.getDocument(ref));
      this.aliases.set(doc.urlId, doc.id);
      this.publish(doc, 'fetch');
      if (!this.listeners.has(doc.id)) this.scheduleExpiry(doc.id);
      return this.documents.get(doc.id) ?? doc;
    })().finally(() => this.inflight.delete(ref));
    this.inflight.set(ref, promise);
    return promise;
  }

  private publish(doc: PrompterDocument, source: 'fetch' | 'webhook'): void {
    const current = this.documents.get(doc.id);
    // Deliveries can arrive out of order; never go back to an older revision.
    if (current && current.revision >= doc.revision) return;
    this.documents.set(doc.id, doc);
    if (current) {
      this.logger.info(
        { id: doc.id, from: current.revision, to: doc.revision, source },
        'document updated',
      );
      this.emit(doc.id, { type: 'document', document: doc });
    }
  }

  /** Whether the document is open somewhere or was fetched moments ago. */
  private isTracked(id: string): boolean {
    return this.listeners.has(id) || this.documents.has(id);
  }

  private scheduleExpiry(id: string): void {
    this.cancelExpiry(id);
    const timer = setTimeout(() => {
      this.expiry.delete(id);
      // Nobody is watching; drop the copy so the next open fetches fresh text.
      if (!this.listeners.has(id)) this.documents.delete(id);
    }, this.graceMs);
    timer.unref?.();
    this.expiry.set(id, timer);
  }

  private cancelExpiry(id: string): void {
    const timer = this.expiry.get(id);
    if (timer) clearTimeout(timer);
    this.expiry.delete(id);
  }

  private emit(id: string, event: HubEvent): void {
    for (const listener of this.listeners.get(id) ?? []) listener(event);
  }

  private toPrompter(doc: OutlineDocument): PrompterDocument {
    return {
      id: doc.id,
      urlId: doc.urlId,
      title: doc.title,
      script: markdownToScript(doc.text),
      revision: doc.revision,
      updatedAt: doc.updatedAt,
      outlineUrl: new URL(doc.url, this.outlinePublicUrl).toString(),
    };
  }
}
