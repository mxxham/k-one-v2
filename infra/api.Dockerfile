# =============================================================================
# K-one v2 — API image
# Builds the monorepo (workspaces) and runs the NestJS API.
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
RUN npm ci --workspace @k-one/api --workspace @k-one/shared \
    || npm install --workspace @k-one/api --workspace @k-one/shared
RUN npm run build -w @k-one/shared && npm run build -w @k-one/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
RUN npm ci --omit=dev --workspace @k-one/api --workspace @k-one/shared \
    || npm install --omit=dev --workspace @k-one/api --workspace @k-one/shared
# Rebuild shared for runtime (its "main" points at dist) using the compiled
# api/worker outputs copied from the build stage.
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
EXPOSE 3000
# Run schema migrations (dist/database/migrate.js reads dist/database/migrations/*.sql)
# then start the API. Idempotent — safe on every container start.
CMD ["sh", "-c", "node apps/api/dist/database/migrate.js && node apps/api/dist/main.js"]
