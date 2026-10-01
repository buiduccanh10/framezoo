FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack install --global pnpm@12.8.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY framezoo-admin/package.json ./framezoo-admin/package.json
COPY framezoo-be/package.json ./framezoo-be/package.json
COPY framezoo-desktop/package.json ./framezoo-desktop/package.json
COPY framezoo-fe/package.json ./framezoo-fe/package.json
COPY framezoo-mobile/package.json ./framezoo-mobile/package.json
# Install dependencies for framezoo-admin
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter framezoo-admin...

# Copy source
COPY framezoo-admin ./framezoo-admin

# Build
RUN pnpm --filter framezoo-admin run build

# Production image
FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

# Copy built assets
COPY --from=builder /app/framezoo-admin/dist /usr/share/nginx/html

# Copy nginx config
COPY framezoo-admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
