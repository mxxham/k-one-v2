# =============================================================================
# K-one v2 — Worker image (BullMQ consumer)
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
RUN npm ci --workspace @k-one/worker --workspace @k-one/shared \
    || npm install --workspace @k-one/worker --workspace @k-one/shared
RUN npm run build -w @k-one/shared && npm run build -w @k-one/worker

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
RUN npm ci --omit=dev --workspace @k-one/worker --workspace @k-one/shared \
    || npm install --omit=dev --workspace @k-one/worker --workspace @k-one/shared
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
CMD ["node", "apps/worker/dist/main.js"]
