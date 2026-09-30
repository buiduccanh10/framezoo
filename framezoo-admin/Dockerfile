FROM node:22-alpine AS builder

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
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/framezoo-admin/dist /usr/share/nginx/html

# Copy nginx config
COPY framezoo-admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
