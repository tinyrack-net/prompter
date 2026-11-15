import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { getMimeType } from 'hono/utils/mime';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { createRuntime } from './runtime.ts';

// Built layout: dist/server/main.js next to dist/app/{client,server}.
const distDirectory = fileURLToPath(new URL('../', import.meta.url));
const clientDirectory = path.join(distDirectory, 'app', 'client');
const serverBuildUrl = new URL('../app/server/index.js', import.meta.url).href;

const handleRequest = createRequestHandler(
  () => import(/* @vite-ignore */ serverBuildUrl) as Promise<ServerBuild>,
  'production',
);

/** Serves built client assets, or returns undefined to fall through to SSR. */
async function serveAsset(request: Request): Promise<Response | undefined> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return undefined;
  }
  const absolute = path.resolve(clientDirectory, `.${pathname}`);
  if (!absolute.startsWith(`${clientDirectory}${path.sep}`)) return undefined;
  const info = await stat(absolute).catch(() => null);
  if (!info?.isFile()) return undefined;
  const headers = new Headers({
    'Content-Type': getMimeType(absolute) ?? 'application/octet-stream',
    'Content-Length': String(info.size),
    'Cache-Control': pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  });
  return new Response(request.method === 'HEAD' ? null : await readFile(absolute), { headers });
}

const { app, config, logger, outline } = createRuntime(handleRequest, serveAsset);

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, 'listening');
});

outline
  .whoami()
  .then((who) => logger.info(who, 'connected to Outline'))
  .catch((err: unknown) =>
    logger.error({ err }, 'cannot reach Outline with the configured API key'),
  );

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    // Open SSE streams would keep the server alive; close them on shutdown.
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
