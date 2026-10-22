# syntax=docker/dockerfile:1
#
# ImÃ¡genes de la API de A-Link. Contexto de construcciÃ³n: la RAÃZ del monorepo.
#   docker build -f apps/api/Dockerfile --target api     -t a-link-api .
#   docker build -f apps/api/Dockerfile --target migrate -t a-link-migrate .
#
# Etapas:
#   deps      todas las dependencias (con las de desarrollo) de api + shared
#   build     compila shared y la API (genera el cliente de Prisma)
#   prod-deps solo dependencias de producciÃ³n (sin Prisma CLI, TypeScript, Vitest...)
#   api       imagen de ejecuciÃ³n mÃ­nima, usuario sin privilegios
#   migrate   ejecuta `prisma migrate deploy` (trabajo de un solo uso, no es el servidor)

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Solo los manifiestos: la capa de dependencias se reutiliza mientras no cambien. El manifiesto de web es
# necesario para que npm valide el lockfile del monorepo, pero sus dependencias NO se instalan.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# --ignore-scripts: ningÃºn paquete ejecuta cÃ³digo de instalaciÃ³n durante la construcciÃ³n (los binarios nativos
# de argon2 y SWC vienen precompilados en el paquete).
RUN npm ci --workspace @a-link/shared --workspace @a-link/api --include-workspace-root --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @a-link/shared && npm run build -w @a-link/api

FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @a-link/shared --workspace @a-link/api --omit=dev --ignore-scripts \
 && npm cache clean --force

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    STORAGE_LOCAL_DIR=/data/storage
WORKDIR /app
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY package.json ./
# Directorio del almacenamiento privado, propiedad del usuario sin privilegios (el volumen lo hereda).
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM deps AS migrate
ENV NODE_ENV=production
# El motor de migraciones de Prisma es un binario que se descarga en la instalación de @prisma/engines (se omitió
# con --ignore-scripts): se obtiene aquí, en la CONSTRUCCIÓN, para que el contenedor no descargue nada al arrancar.
# Necesita OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm rebuild @prisma/engines
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
USER node
WORKDIR /app/apps/api
# La URL de conexiÃ³n llega por la variable DATABASE_URL (nunca va en la imagen).
CMD ["npx", "--no-install", "prisma", "migrate", "deploy"]
