FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV pnpm_config_store_dir=/pnpm/store

RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends ffmpeg postgresql-client redis-tools \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /pnpm/store \
    && chown -R node:node /pnpm

RUN corepack enable \
    && corepack prepare pnpm@11.9.0 --activate \
    && pnpm config set store-dir /pnpm/store
