import { useEffect, useRef, useState } from 'react';
import type { HubEvent, PrompterDocument } from '../../../server/hub.ts';

export type LiveStatus = 'live' | 'reconnecting' | 'deleted';

/**
 * Follows a document over server-sent events. Starts from the server-rendered
 * copy and replaces it whenever Outline publishes a newer revision.
 * EventSource reconnects on its own after network drops.
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
    const source = new EventSource(`/api/documents/${encodeURIComponent(initial.id)}/events`);
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
      setStatus('deleted');
      source.close();
    };
    source.addEventListener('document', onDocument);
    source.addEventListener('deleted', onDeleted);
    source.onopen = () => setStatus((s) => (s === 'deleted' ? s : 'live'));
    source.onerror = () => setStatus((s) => (s === 'deleted' ? s : 'reconnecting'));
    return () => source.close();
  }, [initial.id]);

  return { document, status, lastUpdate };
}
