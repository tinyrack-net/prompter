import './styles/app.css';
import { TRText } from '@tinyrack/ui/components/text';
import type { ReactNode } from 'react';
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';
import { I18nProvider } from '~/i18n/i18n.tsx';
import type { Route } from './+types/root';

export function meta() {
  return [
    { title: 'Prompter' },
    { name: 'description', content: 'A voice-following teleprompter for Outline documents.' },
    { name: 'robots', content: 'noindex, nofollow' },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
];

// The prompter is meant for dark rooms and teleprompter glass, so the app is always dark.
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="tinyrack-dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="dark" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Outlet />
    </I18nProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected error';
  return (
    <main className="launcher">
      <TRText as="h1" variant="headingLg">
        Prompter
      </TRText>
      <TRText as="p" color="muted">
        {message}
      </TRText>
      <a href="/">Back</a>
    </main>
  );
}
