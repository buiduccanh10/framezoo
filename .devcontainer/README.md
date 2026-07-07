# Dev Container

This setup attaches directly to the existing `betamovie-be` service from the main Docker stack in [docker-compose.yaml](/Users/buiduccanh/Code/betamovie/docker-compose.yaml).

When you run `Reopen in Container`, Dev Containers uses:

- the main stack from [docker-compose.yaml](/Users/buiduccanh/Code/betamovie/docker-compose.yaml)
- a small override from [docker-compose.devcontainer.yml](/Users/buiduccanh/Code/betamovie/.devcontainer/docker-compose.devcontainer.yml)

So the stack stays the same shape:

- `postgres`
- `redis`
- `preview-service`
- `betamovie-be`

After attach, wait for the post-create hook to finish. It will:

- copy `example.env` to `.env` when the repo does not already have one
- install workspace dependencies with `pnpm`
- run `pnpm run prepare:be` so Prisma client + Nitro artifacts exist

On each attach, it waits for Postgres and applies Prisma migrations automatically.

Inside the container, use:

```bash
pnpm run dev:be:container
```

The backend is exposed on forwarded port `3000`.

Notes:

- `TMDB_API_KEY` is still blank by default; TMDB-backed features need a real key in `.env`.
- Desktop/Electron packaging is still best run on the host, not inside this dev container.
- `shutdownAction` is `none`, so closing Cursor / VS Code will not tear down your running Docker stack.
