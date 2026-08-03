# Dockerfile pour CitronHUD (Pile serveur / Next.js Admin + API)
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app /app

EXPOSE 3000

# Les migrations passent au démarrage, pas dans une étape séparée : un
# déploiement en une commande ne doit pas laisser le schéma en retard sur le
# code. Elles sont idempotentes, et `depends_on: service_healthy` garantit que
# PostgreSQL répond déjà.
CMD ["sh", "-c", "pnpm --filter @citronhud/server db:migrate && pnpm --filter @citronhud/server start"]
