# syntax=docker/dockerfile:1

FROM node:24-slim AS base
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Runtime dependencies only, installed into a clean tree.
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.js"]
