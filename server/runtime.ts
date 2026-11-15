import pino from 'pino';
import { RouterContextProvider } from 'react-router';
import { type ServerRuntime, serverRuntimeContext } from '../app/lib/runtime-context.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { DocumentHub } from './hub.ts';
import { OutlineClient } from './outline.ts';

type RequestHandler = (request: Request, context: RouterContextProvider) => Promise<Response>;

/**
 * Builds the Hono app from the environment, shared by dev and production.
 * `frontend` renders React Router; its loaders get the document hub through
 * the router context instead of making HTTP calls back to this server.
 */
export function createRuntime(
  frontend: RequestHandler,
  serveAsset?: (request: Request) => Promise<Response | undefined>,
) {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const outline = new OutlineClient({
    baseUrl: config.OUTLINE_URL,
    apiKey: config.OUTLINE_API_KEY,
  });
  const hub = new DocumentHub(outline, config.OUTLINE_PUBLIC_URL, logger);
  const runtime: ServerRuntime = { getDocument: (ref) => hub.get(ref) };

  const app = createApp({
    outline,
    hub,
    logger,
    webhookSecret: config.OUTLINE_WEBHOOK_SECRET,
    frontend: async (request) => {
      const asset = await serveAsset?.(request);
      if (asset) return asset;
      const context = new RouterContextProvider();
      context.set(serverRuntimeContext, runtime);
      const response = await frontend(request, context);
      const headers = new Headers(response.headers);
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { headers, status: response.status });
    },
  });
  return { app, config, logger, outline };
}
