import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/launcher.tsx'),
  route('d/:id', 'routes/document.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig;
