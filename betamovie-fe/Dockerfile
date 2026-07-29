FROM node:22-alpine AS build
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY betamovie-fe/package.json ./betamovie-fe/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter betamovie-fe...

ARG BACKEND_URL

ENV VITE_BACKEND_URL=${BACKEND_URL}

COPY betamovie-fe ./betamovie-fe
RUN pnpm --filter betamovie-fe build

# production environment
FROM nginx:stable-alpine
COPY --from=build /app/betamovie-fe/dist /usr/share/nginx/html
COPY betamovie-fe/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
