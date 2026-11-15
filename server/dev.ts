import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { createServer as createViteServer } from 'vite';
import { createRuntime } from './runtime.ts';

const httpServer = createServer();
const vite = await createViteServer({
  appType: 'custom',
  server: { middlewareMode: { server: httpServer } },
});

const handleRequest = createRequestHandler(
  () => vite.ssrLoadModule('virtual:react-router/server-build') as Promise<ServerBuild>,
  'development',
);

const { app, config, logger } = createRuntime(handleRequest);
const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });

httpServer.on('request', (req, res) => {
  vite.middlewares(req, res, () => {
    listener(req, res).catch((err: unknown) => {
      logger.error({ err }, 'request failed');
      if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
    });
  });
});

httpServer.listen(config.PORT, '0.0.0.0', () => {
  logger.info({ port: config.PORT }, 'dev server listening');
});
