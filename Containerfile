FROM docker.io/oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/customer/package.json apps/customer/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN bun run typecheck && bun run build

FROM docker.io/oven/bun:1.4.0 AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 UPLOAD_DIR=/data/uploads
COPY --from=build --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/apps/api ./apps/api
COPY --from=build --chown=bun:bun /app/packages ./packages
COPY --from=build --chown=bun:bun /app/assets ./assets
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build /app/apps/admin/dist /app/public/admin
COPY --from=build /app/apps/customer/dist /app/public/customer
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["bun", "scripts/health.ts"]
CMD ["bun", "apps/api/src/index.ts"]
