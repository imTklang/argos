# Argos: the dashboard API and the scheduled worker share this image.
# docker compose up -d runs both; see docs/deploy.md.

FROM node:22-bookworm-slim AS build
# Toolchain for better-sqlite3 in case no prebuilt binary fits.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:web

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
	API_HOST=0.0.0.0 \
	TZ=America/Fortaleza
WORKDIR /app
COPY --from=build /app /app
# The data volume (database, preferences, résumé) belongs to this user.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3333
# One node process, so SIGTERM reaches the app and a scan can finish.
CMD ["node", "--import", "tsx", "apps/api/src/serve.ts"]
