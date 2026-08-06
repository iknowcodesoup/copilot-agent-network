FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agentic-executor/package.json ./apps/agentic-executor/package.json
COPY apps/agentic-executor-e2e/package.json ./apps/agentic-executor-e2e/package.json
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/agentic-executor/node_modules ./apps/agentic-executor/node_modules
RUN npx nx build @agentic-executor/agentic-executor

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/agentic-executor/.next/standalone ./
COPY --from=builder /app/apps/agentic-executor/.next/static ./apps/agentic-executor/.next/static
COPY --from=builder /app/apps/agentic-executor/public ./apps/agentic-executor/public
EXPOSE 3000
CMD ["node", "apps/agentic-executor/server.js"]