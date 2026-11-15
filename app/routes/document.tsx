import { TRLinkButton } from '@tinyrack/ui/components/link-button';
import { TRText } from '@tinyrack/ui/components/text';
import { data, isRouteErrorResponse, Link } from 'react-router';
import { PrompterPage } from '~/features/prompter/prompter-page.tsx';
import { useI18n } from '~/i18n/i18n.tsx';
import { serverRuntimeContext } from '~/lib/runtime-context.ts';
import type { PrompterDocument } from '../../server/hub.ts';
import { OutlineError } from '../../server/outline.ts';
import type { Route } from './+types/document';

/** Loads the document in-process from the server's document hub. */
export async function loader({ params, context }: Route.LoaderArgs): Promise<PrompterDocument> {
  const runtime = context.get(serverRuntimeContext);
  if (!runtime) throw new Error('Server runtime is not available');
  try {
    return await runtime.getDocument(params.id);
  } catch (err) {
    const status = err instanceof OutlineError && err.status === 404 ? 404 : 502;
    throw data(null, { status });
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.title} · Prompter` : 'Prompter' }];
}

export default function DocumentRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by document so navigating between documents starts fresh.
  return <PrompterPage key={loaderData.id} initial={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useI18n();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="launcher">
      <TRText as="h1" variant="headingLg">
        {t.documentUnavailable}
      </TRText>
      <TRText as="p" color="muted">
        {t.documentUnavailableHint} ({status})
      </TRText>
      <TRLinkButton className="self-start" render={<Link to="/" />}>
        {t.backToLauncher}
      </TRLinkButton>
    </main>
  );
}
