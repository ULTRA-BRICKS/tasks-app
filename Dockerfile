ARG BUN_IMAGE=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM ${BUN_IMAGE} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM ${BUN_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 LINEAR_QUEUE_DRIVER=postgres
COPY --from=dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build --chown=bun:bun /app/docs/openapi.json ./docs/openapi.json
COPY --from=build --chown=bun:bun /app/src/shared ./src/shared
COPY --from=build --chown=bun:bun /app/vendor ./vendor
COPY --from=build --chown=bun:bun /app/dist ./dist
USER bun
EXPOSE 8080
CMD ["bun", "scripts/serve-production.mjs"]
