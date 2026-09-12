FROM node:22-alpine AS builder

WORKDIR /app
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@12.3.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY framezoo-admin/package.json ./framezoo-admin/package.json
COPY patches ./patches

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
