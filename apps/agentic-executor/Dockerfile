FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g npm@11.7.0
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
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