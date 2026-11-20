FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/mcp/package.json packages/mcp/
COPY services/email-api/package.json services/email-api/
COPY services/crm-api/package.json services/crm-api/
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS email
RUN pnpm --filter @meridian/email-api build
ENV PORT=4001
EXPOSE 4001
CMD ["node", "services/email-api/dist/index.js"]

FROM deps AS crm
RUN pnpm --filter @meridian/crm-api build
ENV PORT=4002
EXPOSE 4002
CMD ["node", "services/crm-api/dist/index.js"]

FROM deps AS web
RUN pnpm --filter @meridian/web build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "@meridian/web", "start"]
