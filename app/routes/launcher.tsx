import { LauncherPage } from '~/features/launcher/launcher-page.tsx';
import type { Route } from './+types/launcher';

export function loader({ request }: Route.LoaderArgs) {
  // Behind Traefik the request URL is http://; trust the forwarded scheme for the bookmarklet.
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') ?? url.host;
  return { origin: `${proto}://${host}` };
}

export default function Launcher({ loaderData }: Route.ComponentProps) {
  return <LauncherPage origin={loaderData.origin} />;
}
