import { TRText } from '@tinyrack/ui/components/text';
import { useEffect, useState } from 'react';
import { useI18n } from '~/i18n/i18n.tsx';
import type { LiveStatus } from './use-live-document.ts';
import type { VoiceStatus } from './use-voice-cursor.ts';

interface VoiceStatusPillProps {
  status: VoiceStatus;
  heard: string;
  live: LiveStatus;
  /** When the document last changed in Outline (ms), or null. */
  lastUpdate: number | null;
}

/** How long the "Updated from Outline" note stays visible. */
const UPDATE_NOTE_MS = 4000;

/**
 * The only place voice and sync status is shown: a small pill in the top-left
 * corner. Transient problems show a short hint that disappears by itself, so
 * nothing ever needs to be dismissed.
 */
export function VoiceStatusPill({ status, heard, live, lastUpdate }: VoiceStatusPillProps) {
  const { t } = useI18n();
  const recentlyUpdated = useRecent(lastUpdate, UPDATE_NOTE_MS);

  const voiceLabel = (() => {
    switch (status.kind) {
      case 'listening':
        return t.listening;
      case 'idle':
        return t.paused;
      case 'interrupted':
        return t.voiceInterrupted[status.reason];
      case 'denied':
        return t.voiceDenied;
      case 'unsupported':
        return t.voiceUnsupported;
    }
  })();

  const hint =
    status.kind === 'denied'
      ? t.micDeniedBody
      : status.kind === 'unsupported'
        ? t.unsupportedBody
        : undefined;

  // Voice problems take precedence; sync notes are secondary.
  const state =
    status.kind === 'listening' || status.kind === 'idle'
      ? live === 'reconnecting'
        ? 'sync-lost'
        : recentlyUpdated
          ? 'updated'
          : status.kind
      : status.kind;
  const label =
    state === 'sync-lost' ? t.connectionLost : state === 'updated' ? t.liveUpdated : voiceLabel;

  return (
    <div className="prompter-status" data-state={state} title={hint}>
      <span className="prompter-status-dot" aria-hidden="true" />
      {/* role=status announces changes politely without interrupting reading. */}
      <TRText variant="caption" className="prompter-status-state" role="status">
        {label}
      </TRText>
      {state === 'listening' && heard ? (
        <TRText variant="caption" color="muted" truncate className="prompter-heard" title={t.heard}>
          {heard}
        </TRText>
      ) : null}
    </div>
  );
}

/** True for `durationMs` after `timestamp` changes. */
function useRecent(timestamp: number | null, durationMs: number): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (timestamp === null) return;
    setActive(true);
    const timer = setTimeout(() => setActive(false), durationMs);
    return () => clearTimeout(timer);
  }, [timestamp, durationMs]);
  return active;
}
