# syntax=docker/dockerfile:1

# ---------- Base ----------
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Corepack downloads whatever pnpm version it is told to use. Without a
# pinned version it fetches the latest pnpm release, which can be
# incompatible with this project's lockfile (pnpm's config format changes
# between majors). Pinning here — matching the "packageManager" field in
# package.json — makes the build reproducible.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# ---------- Dependencies ----------
FROM base AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# ---------- Builder ----------
FROM base AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

# ---------- Runner ----------
FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app

# Run as an unprivileged user rather than root.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# `output: "standalone"` (see next.config.mjs) traces the exact production
# dependency graph into .next/standalone, so the runner only ever needs
# that folder plus the static assets and public files — no full
# node_modules, no pnpm, no build tooling in the final image.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
