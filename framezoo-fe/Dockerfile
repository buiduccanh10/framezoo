FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack install --global pnpm@12.8.1

COPY framezoo-fe/package.json ./framezoo-fe/package.json
COPY framezoo-desktop/package.json ./framezoo-desktop/package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY framezoo-admin/package.json ./framezoo-admin/package.json
COPY framezoo-be/package.json ./framezoo-be/package.json
COPY framezoo-mobile/package.json ./framezoo-mobile/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter framezoo-fe...

ARG BACKEND_URL

ENV VITE_BACKEND_URL=${BACKEND_URL}

COPY framezoo-desktop/renderer-src/src/components/Icon.tsx ./framezoo-desktop/renderer-src/src/components/Icon.tsx
COPY framezoo-fe ./framezoo-fe
RUN pnpm --filter framezoo-fe build

# production environment
FROM nginx:stable-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94
COPY --from=build /app/framezoo-fe/dist /usr/share/nginx/html
COPY framezoo-fe/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
