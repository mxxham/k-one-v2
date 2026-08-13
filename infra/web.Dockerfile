# =============================================================================
# K-one v2 — Frontend build + serve image
#
# Build context: the monorepo root (D:\K-one-v2). The existing React SPA must
# be present at ./frontend (e.g. copy/symlink D:\K-one\k-one\frontend there,
# or run:  xcopy /E /I D:\K-one\k-one\frontend D:\K-one-v2\frontend).
# VITE_API_BASE points at the nginx-proxied /k-one/api path.
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci || npm install
COPY frontend/ ./
ARG VITE_API_BASE=/k-one/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
