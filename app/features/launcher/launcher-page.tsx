import { TRField } from '@tinyrack/ui/components/field';
import { TRIconButton } from '@tinyrack/ui/components/icon-button';
import { TRInput } from '@tinyrack/ui/components/input';
import { TRLinkButton } from '@tinyrack/ui/components/link-button';
import { TRSpinner } from '@tinyrack/ui/components/spinner';
import { TRText } from '@tinyrack/ui/components/text';
import { BookmarkIcon, FileTextIcon, SettingsIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SettingsDrawer } from '~/components/settings-drawer.tsx';
import { useI18n } from '~/i18n/i18n.tsx';
import { useRecentDocuments } from '~/state/settings-store.ts';
import { detectScriptLanguage } from '~core/language.ts';
import { forgetRecent } from '~core/settings.ts';

interface SearchResult {
  id: string;
  title: string;
  updatedAt: string;
  context: string;
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: SearchResult[] }
  | { kind: 'error' };

const SEARCH_DELAY_MS = 250;

/** Turns `javascript:` bookmarklet source into an href; kept small on purpose. */
function bookmarkletHref(origin: string): string {
  const code = `(()=>{const m=location.pathname.match(/\\/doc\\/(?:[^/]*-)?([A-Za-z0-9]{10})/);if(!m){alert('Open an Outline document first.');return;}window.open('${origin}/d/'+m[1],'_blank');})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function LauncherPage({ origin }: { origin: string }) {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [recent, setRecent] = useRecentDocuments();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requestId = useRef(0);

  // Debounced search; with an empty query, list recently updated documents.
  useEffect(() => {
    const id = ++requestId.current;
    const q = query.trim();
    setSearch({ kind: 'loading' });
    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/documents?q=${encodeURIComponent(q)}`);
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { results: SearchResult[]; direct: boolean };
          if (id !== requestId.current) return;
          // A pasted link or ID opens the document right away.
          const first = body.results[0];
          if (body.direct && first) {
            navigate(`/d/${first.id}`);
            return;
          }
          setSearch({ kind: 'done', results: body.results });
        } catch {
          if (id === requestId.current) setSearch({ kind: 'error' });
        }
      },
      q ? SEARCH_DELAY_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [query, navigate]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );
  const detected = detectScriptLanguage(query) ?? language;

  return (
    <main className="launcher">
      <header className="launcher-header">
        <div className="flex flex-col gap-tinyrack-xs">
          <TRText as="h1" variant="headingLg">
            {t.launcherTitle}
          </TRText>
          <TRText as="p" color="muted">
            {t.launcherHint}
          </TRText>
        </div>
        <TRIconButton
          appearance="outline"
          aria-label={t.settings}
          title={t.settings}
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon aria-hidden="true" />
        </TRIconButton>
      </header>

      <TRField.Root name="q">
        <TRField.Label>{t.searchLabel}</TRField.Label>
        <TRInput
          type="search"
          uiSize="lg"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder={t.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </TRField.Root>

      {query.trim() === '' && recent.length > 0 ? (
        <section className="launcher-section" aria-labelledby="recent-heading">
          <TRText as="h2" id="recent-heading" variant="label" color="muted">
            {t.recentlyOpened}
          </TRText>
          <ul className="launcher-list">
            {recent.map((doc) => (
              <li key={doc.id} className="launcher-item">
                <Link to={`/d/${doc.id}`} className="launcher-link">
                  <FileTextIcon aria-hidden="true" className="launcher-icon" />
                  <TRText truncate>{doc.title}</TRText>
                </Link>
                <TRIconButton
                  appearance="ghost"
                  uiSize="sm"
                  aria-label={`${t.forget}: ${doc.title}`}
                  title={t.forget}
                  onClick={() => setRecent(forgetRecent(doc.id))}
                >
                  <XIcon aria-hidden="true" />
                </TRIconButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="launcher-section"
        aria-labelledby="results-heading"
        aria-busy={search.kind === 'loading'}
      >
        <TRText as="h2" id="results-heading" variant="label" color="muted">
          {query.trim() ? t.searchResults : t.recentlyUpdated}
        </TRText>
        {search.kind === 'loading' ? (
          <TRSpinner label={t.searchResults} />
        ) : search.kind === 'error' ? (
          <TRText as="p" color="danger" role="alert">
            {t.searchFailed}
          </TRText>
        ) : search.kind === 'done' && search.results.length === 0 ? (
          <TRText as="p" color="muted">
            {t.noResults}
          </TRText>
        ) : search.kind === 'done' ? (
          <ul className="launcher-list">
            {search.results.map((doc) => (
              <li key={doc.id} className="launcher-item">
                <Link to={`/d/${doc.id}`} className="launcher-link launcher-link-result">
                  <FileTextIcon aria-hidden="true" className="launcher-icon" />
                  <span className="launcher-result-text">
                    <TRText truncate weight="medium">
                      {doc.title}
                    </TRText>
                    <TRText variant="caption" color="muted" truncate>
                      {doc.context || t.updatedAt(dateFormat.format(new Date(doc.updatedAt)))}
                    </TRText>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="launcher-section" aria-labelledby="bookmarklet-heading">
        <TRText as="h2" id="bookmarklet-heading" variant="label" color="muted">
          {t.bookmarkletTitle}
        </TRText>
        <TRText as="p" variant="bodySm" color="muted">
          {t.bookmarkletHint}
        </TRText>
        <TRLinkButton
          appearance="outline"
          className="self-start"
          // React refuses javascript: URLs in JSX, so the href is set on the node.
          ref={(node) => node?.setAttribute('href', bookmarkletHref(origin))}
          href="#bookmarklet"
          // A bookmarklet is meant to be dragged to the bookmarks bar, not followed here.
          onClick={(event) => event.preventDefault()}
        >
          <BookmarkIcon aria-hidden="true" />
          {t.bookmarkletLabel}
        </TRLinkButton>
      </section>

      <SettingsDrawer
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        detectedSpeechLanguage={detected}
      />
    </main>
  );
}
