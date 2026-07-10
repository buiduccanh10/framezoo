FROM node:22-alpine

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && apk add --no-cache curl

COPY betamovie-be/package.json ./betamovie-be/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

# betamovie-be prepare runs prisma generate; install without lifecycle until sources exist.
# Keep the workspace shape stable after this layer. Adding another workspace
# package.json later makes pnpm reconcile the workspace again during `pnpm run`,
# which drags deploys by re-resolving/downloading unrelated packages.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter betamovie-be...

COPY betamovie-be ./betamovie-be

# prisma.config.ts reads DATABASE_URL; generate does not connect
RUN DATABASE_URL="${DATABASE_URL:-postgresql://prisma:prisma@127.0.0.1:5432/prisma}" \
    pnpm --filter betamovie-be run prepare

ENV NODE_ENV=production

RUN pnpm --filter betamovie-be run build

EXPOSE 3000

CMD ["sh", "-c", "pnpm --filter betamovie-be exec prisma migrate deploy && pnpm --filter betamovie-be exec prisma db seed && node betamovie-be/.output/server/index.mjs"]
