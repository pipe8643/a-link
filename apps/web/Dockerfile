# syntax=docker/dockerfile:1
#
# Imagen del frontend: estÃ¡ticos + Nginx (TLS, cabeceras, CSP, lÃ­mites y proxy de /api hacia la API).
# Contexto de construcciÃ³n: la RAÃZ del monorepo.
#   docker build -f apps/web/Dockerfile -t a-link-web .
#
# La licencia de ZoomCharts NO se compila en el bundle: el script de arranque genera /config.js desde variables de
# entorno cada vez que arranca el contenedor.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.28-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @a-link/shared --workspace @a-link/web --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @a-link/shared && npm run build -w @a-link/web

FROM ${NGINX_IMAGE} AS web
USER root
# openssl solo se usa para generar un certificado AUTOFIRMADO de pruebas cuando no se monta uno real.
RUN apk add --no-cache openssl && rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx/nginx.conf /etc/nginx/nginx.conf
COPY apps/web/nginx/alink-headers.conf apps/web/nginx/alink-headers-embed.conf apps/web/nginx/alink-proxy.conf /etc/nginx/
COPY --chmod=0755 apps/web/nginx/40-alink-runtime.sh /docker-entrypoint.d/40-alink-runtime.sh
COPY --from=build --chown=root:root /app/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["wget", "--no-check-certificate", "-q", "-O", "/dev/null", "https://127.0.0.1:8443/healthz"]
