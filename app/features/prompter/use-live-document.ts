import { useEffect, useRef, useState } from 'react';
import type { HubEvent, PrompterDocument } from '../../../server/hub.ts';

export type LiveStatus = 'live' | 'reconnecting' | 'deleted';

/** Delays before reopening a stream the browser gave up on. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Follows a document over server-sent events. Starts from the server-rendered
 * copy and replaces it whenever Outline publishes a newer revision.
 *
 * EventSource reconnects on its own after network drops, but gives up for good
 * when a reconnect gets an error response (e.g. a 502 while Outline or the
 * server restarts). Then a new stream is opened with exponential backoff; the
 * server sends the current document first, so missed edits arrive on reconnect.
 */
export function useLiveDocument(initial: PrompterDocument) {
  const [document, setDocument] = useState(initial);
  const [status, setStatus] = useState<LiveStatus>('live');
  /** Revision that arrived while the reader was viewing the previous one. */
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const revisionRef = useRef(initial.revision);

  // A different document was navigated to.
  if (initial.id !== document.id) {
    revisionRef.current = initial.revision;
    setDocument(initial);
    setStatus('live');
    setLastUpdate(null);
  }

  useEffect(() => {
    const url = `/api/documents/${encodeURIComponent(initial.id)}/events`;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = RETRY_MIN_MS;
    let stopped = false;

    const onDocument = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as HubEvent;
      if (event.type !== 'document') return;
      setStatus('live');
      if (event.document.revision <= revisionRef.current) return;
      revisionRef.current = event.document.revision;
      setDocument(event.document);
      setLastUpdate(Date.now());
    };
    const onDeleted = () => {
      stopped = true;
      setStatus('deleted');
      source?.close();
    };

    const connect = () => {
      retryTimer = null;
      if (stopped) return;
      const next = new EventSource(url);
      source = next;
      next.addEventListener('document', onDocument);
      next.addEventListener('deleted', onDeleted);
      next.onopen = () => {
        retryDelay = RETRY_MIN_MS;
        setStatus((s) => (s === 'deleted' ? s : 'live'));
      };
      next.onerror = () => {
        if (stopped) return;
        setStatus((s) => (s === 'deleted' ? s : 'reconnecting'));
        // CONNECTING: the browser retries by itself. CLOSED: it gave up.
        if (next.readyState === EventSource.CLOSED) scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
    };

    // Back online: retry now instead of waiting out the backoff.
    const onOnline = () => {
      if (stopped || source?.readyState !== EventSource.CLOSED) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryDelay = RETRY_MIN_MS;
      connect();
    };

    connect();
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
      source?.close();
    };
  }, [initial.id]);

  return { document, status, lastUpdate };
}
