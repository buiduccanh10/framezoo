FROM node:22-alpine AS build
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY framezoo-fe/package.json ./framezoo-fe/package.json
COPY framezoo-desktop/package.json ./framezoo-desktop/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter framezoo-fe...

ARG BACKEND_URL

ENV VITE_BACKEND_URL=${BACKEND_URL}

COPY framezoo-desktop/renderer-src/src/components/Icon.tsx ./framezoo-desktop/renderer-src/src/components/Icon.tsx
COPY framezoo-fe ./framezoo-fe
RUN pnpm --filter framezoo-fe build

# production environment
FROM nginx:stable-alpine
COPY --from=build /app/framezoo-fe/dist /usr/share/nginx/html
COPY framezoo-fe/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
