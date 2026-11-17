import { TRLinkButton } from '@tinyrack/ui/components/link-button';
import { TRProgress } from '@tinyrack/ui/components/progress';
import { TRText } from '@tinyrack/ui/components/text';
import { ArrowLeftIcon, ExternalLinkIcon } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SettingsDrawer } from '~/components/settings-drawer.tsx';
import { useI18n } from '~/i18n/i18n.tsx';
import { useFullscreen } from '~/lib/use-fullscreen.ts';
import { useRecentDocuments, useSettings } from '~/state/settings-store.ts';
import { detectScriptLanguage, resolveLanguage, SPEECH_LOCALE } from '~core/language.ts';
import { countSpoken, parseScript } from '~core/script.ts';
import { rememberRecent } from '~core/settings.ts';
import type { PrompterDocument } from '../../../server/hub.ts';
import { PlaybackToolbar } from './playback-toolbar.tsx';
import { ScriptView } from './script-view.tsx';
import { useLiveDocument } from './use-live-document.ts';
import { useVoiceCursor } from './use-voice-cursor.ts';
import { VoiceStatusPill } from './voice-status.tsx';

/**
 * Shows one Outline document. It opens paused: recognition starts from the
 * mic button, so the permission prompt follows a user gesture.
 */
export function PrompterPage({ initial }: { initial: PrompterDocument }) {
  const { t, language: uiLanguage } = useI18n();
  const [settings] = useSettings();
  const [, setRecent] = useRecentDocuments();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const { document: doc, status: liveStatus, lastUpdate } = useLiveDocument(initial);

  // Remember the document (and its latest title) for the launcher, and keep
  // the tab title current when the document is renamed in Outline.
  useEffect(() => {
    setRecent(rememberRecent({ id: doc.id, title: doc.title }));
    window.document.title = `${doc.title} · Prompter`;
  }, [doc.id, doc.title, setRecent]);

  const detected = useMemo(
    () => detectScriptLanguage(doc.script) ?? uiLanguage,
    [doc.script, uiLanguage],
  );
  const speechLanguage = resolveLanguage(settings.speechLanguage, () => detected);
  const locale = SPEECH_LOCALE[speechLanguage];
  // A new revision produces new tokens; useVoiceCursor remaps the reading
  // position onto them, so live updates never lose the reader's place.
  const tokens = useMemo(
    () => parseScript(doc.script, speechLanguage),
    [doc.script, speechLanguage],
  );
  const total = useMemo(() => countSpoken(tokens), [tokens]);
  const empty = total === 0;

  const voice = useVoiceCursor(tokens, locale);
  const fullscreen = useFullscreen();
  const { stop, toggle, next, prev, restart } = voice;
  const scrollToCursor = useCallback(() => setScrollRequest((n) => n + 1), []);

  useEffect(() => {
    if (empty || liveStatus === 'deleted') stop();
  }, [empty, liveStatus, stop]);

  // Keyboard shortcuts (ignored while the settings drawer is open).
  useEffect(() => {
    if (settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = keyAction(e.key, {
        toggle: () => !empty && toggle(),
        next,
        prev,
        restart,
        scrollToCursor,
        settings: () => setSettingsOpen(true),
        fullscreen: () => {
          if (fullscreen.supported && !fullscreen.browserManaged) void fullscreen.toggle();
        },
      });
      if (!action) return;
      e.preventDefault();
      // The toolbar uses arrow keys to move between its buttons; the prompter
      // shortcuts take priority so they work after clicking a toolbar button.
      e.stopPropagation();
      action();
    };
    // Capture phase: run before focused widgets (the toolbar) handle the key.
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [settingsOpen, empty, toggle, next, prev, restart, scrollToCursor, fullscreen]);

  const done = countSpoken(tokens, voice.cursor);
  const style = {
    '--prompter-font-size': `${settings.fontSize}px`,
    '--prompter-margin-x': `${settings.marginX}vw`,
    '--prompter-reading-line': `${settings.readingLine}%`,
    '--prompter-reading-offset': `${settings.readingLine}cqh`,
    '--prompter-tail-space': `${100 - settings.readingLine}cqh`,
  } as CSSProperties;

  return (
    <main
      ref={rootRef}
      className="prompter"
      style={style}
      data-mirror={settings.mirror ? '' : undefined}
      // Focus target after the settings drawer closes, so shortcuts keep working.
      tabIndex={-1}
    >
      <TRProgress.Root
        className="prompter-progress"
        aria-label={t.progress}
        value={done}
        max={Math.max(total, 1)}
      >
        <TRProgress.Track>
          <TRProgress.Indicator />
        </TRProgress.Track>
      </TRProgress.Root>

      {empty || liveStatus === 'deleted' ? (
        <div className="prompter-empty">
          <TRText as="h1" variant="headingLg">
            {doc.title}
          </TRText>
          <TRText as="p" color="muted">
            {liveStatus === 'deleted' ? t.documentDeleted : t.emptyDocument}
          </TRText>
        </div>
      ) : (
        <div className="prompter-scroller" data-scroller="">
          <div className="prompter-reading-line" aria-hidden="true" />
          <ScriptView
            tokens={tokens}
            cursor={voice.cursor}
            language={speechLanguage}
            wrap={settings.lineWrap}
            readingLine={settings.readingLine}
            scrollRequest={scrollRequest}
            onWordClick={voice.jumpTo}
          />
        </div>
      )}

      <VoiceStatusPill
        status={voice.status}
        heard={voice.heard}
        live={liveStatus}
        lastUpdate={lastUpdate}
      />

      <nav className="prompter-doc" aria-label={doc.title}>
        <TRLinkButton
          appearance="ghost"
          className="tr-icon-btn"
          aria-label={t.backToLauncher}
          title={t.backToLauncher}
          render={<Link to="/" />}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </TRLinkButton>
        <TRText variant="caption" truncate className="prompter-doc-title">
          {doc.title}
        </TRText>
        <TRLinkButton
          appearance="ghost"
          className="tr-icon-btn"
          aria-label={t.openInOutline}
          title={t.openInOutline}
          href={doc.outlineUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLinkIcon aria-hidden="true" />
        </TRLinkButton>
      </nav>

      <PlaybackToolbar
        listening={voice.listening}
        canListen={!empty && liveStatus !== 'deleted' && voice.status.kind !== 'unsupported'}
        onRestart={restart}
        onPrev={prev}
        onToggle={toggle}
        onNext={next}
        onScrollToCursor={scrollToCursor}
        onSettings={() => setSettingsOpen(true)}
        fullscreen={
          fullscreen.supported
            ? {
                active: fullscreen.active,
                browserManaged: fullscreen.browserManaged,
                onToggle: () => void fullscreen.toggle(),
              }
            : undefined
        }
      />

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        detectedSpeechLanguage={detected}
        returnFocus={rootRef}
      />
    </main>
  );
}

type PrompterActions = Record<
  'toggle' | 'next' | 'prev' | 'restart' | 'scrollToCursor' | 'settings' | 'fullscreen',
  () => void
>;

function keyAction(key: string, actions: PrompterActions): (() => void) | null {
  switch (key) {
    case ' ':
      return actions.toggle;
    case 'ArrowRight':
    case 'ArrowDown':
      return actions.next;
    case 'ArrowLeft':
    case 'ArrowUp':
      return actions.prev;
    case 'Home':
      return actions.restart;
    case 'c':
    case 'C':
      return actions.scrollToCursor;
    case ',':
    case 's':
    case 'S':
      return actions.settings;
    case 'f':
    case 'F':
      return actions.fullscreen;
    default:
      return null;
  }
}
