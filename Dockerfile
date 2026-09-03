# Build and runtime are separate stages so the VPS never has to hold Next.js's
# build-time memory spike (1–1.5 GB). Build anywhere, run in ~250 MB.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Fonts are fetched by next/font at build time; the runtime needs no network for them.
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# better-sqlite3 is a native module; copying node_modules from the build stage
# keeps the compiled binary and avoids a toolchain in the runtime image.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.ts ./
# src carries schema.sql (read at startup) and the gateway lib that scripts import.
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docs/API.md ./docs/API.md
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npx", "next", "start"]
