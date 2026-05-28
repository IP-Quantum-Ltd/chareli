FROM node:24-alpine AS builder
WORKDIR /app

# Toolchain for bcrypt's node-gyp compile on musl.
# sharp ships prebuilt binaries for linuxmusl-x64, so it doesn't need these,
# but bcrypt@6 still compiles from source on Alpine.
RUN apk add --no-cache g++ make python3

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

# Manifest layer — cached unless deps change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install everything (dev + prod). pnpm-workspace.yaml's `allowBuilds`
# whitelist is what permits bcrypt/sharp/msgpackr-extract to build.
RUN pnpm install --frozen-lockfile

# Source + build (tsc + postbuild via ts-node).
COPY . .
RUN pnpm run build

# Strip devDependencies from the existing tree in place.
# No re-resolution, no rebuild of native modules.
RUN pnpm prune --prod


# ---- Production ----
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production \
  PM2_INSTANCES=2

# Create the unprivileged user FIRST so --chown works inline on each COPY.
# This avoids a recursive chown over node_modules later, which is slow.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Bring across only what production needs, with correct ownership in one pass.
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/ormconfig.json ./

COPY --chown=appuser:appgroup healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# Create writable dirs while still root, then drop privileges.
# Doing this AFTER USER appuser was the bug in the original — non-root cannot chown.
RUN mkdir -p /app/logs /app/dist/migrations && \
  chown -R appuser:appgroup /app/logs /app/dist/migrations

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/healthcheck.sh"]

# Use direct binary paths (no npx fetch surprises at startup).
# PM2_INSTANCES is env-controlled so your task definition can override per cluster.
CMD ["sh", "-c", "node_modules/.bin/typeorm migration:run -d dist/config/database.js && node_modules/.bin/pm2-runtime start dist/index.js -i max"]
