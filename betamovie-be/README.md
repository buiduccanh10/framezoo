# BackendV2
follow me on [GitHub](https://github.com/FifthWit)

BackendV2 is a from scratch rewrite of movie-web's backend using [Nitro](https://nitro.build), and [Prisma](https://prisma.io). 

## Deployment
There are multiple supported ways to deploy BackendV2 based on your needs:
### NixPacks
1. Install NixPacks with
```sh
# Mac
brew install nixpacks
# POSIX (mac, linux)
curl -sSL https://nixpacks.com/install.sh | bash
# Windows
irm https://nixpacks.com/install.ps1 | iex
```
2. Build the backend
```sh
nixpacks build ./path/to/app --name my-app # my-app will be the container name aswell
```
3. Run the container
```sh
docker run my-app
```
> [!TIP]
If you use a tool like Dokploy or Coolify, NixPacks support is out of the box
### Railpack
Railpack is the successor to NixPacks, to run the backend via Railpack:

1. Install [Railpack](https://railpack.com/installation)

2. Run BuildKit and set BuildKit host
```sh
docker run --rm --privileged -d --name buildkit moby/buildki

export BUILDKIT_HOST='docker-container://buildkit'
```

3. Build Backend
```sh
cd ./path/to/backend
railpack build .
```

4. Run Backend container
```sh
# Run manually
docker run -it backend
# Run in the background
docker run -d -it backend
```

5. Verify it's running
```sh
docker ps
# You should see backend, and buildkit running
```

### Manually
1. Git clone the environment
```sh
git clone https://github.com/p-stream/backend.git
cd backend
```
2. Build the backend
```sh
npm install && npm run build
```
3. Run the backend
```sh
node .nitro/index.mjs
```

## Setup your environment variables:
To run the backend you need environment variables setup
1. Create .env file
```sh
cp .env.example .env
```

2. Fill in the values in the .env file

> [!NOTE]
> for postgres you may want to use a service like [Neon](https://neon.tech) or host your own with docker, to do that just look it up

### Optional: Sprite + VTT hover previews
The stream API can return hover preview metadata in two modes:

1. Auto-generate with the bundled `preview-service` Docker service using `ffmpeg`
2. Use an external VTT/sprite source if you already have one

Environment variables:
```sh
# Auto-generated preview service
PREVIEW_SERVICE_URL=http://preview-service:3100
PREVIEW_BACKEND_INTERNAL_BASE_URL=http://p-stream:3000
PREVIEW_INTERVAL_SECONDS=10
PREVIEW_FRAME_WIDTH=320
PREVIEW_TILE_COLS=5
PREVIEW_TILE_ROWS=5
PREVIEW_MAX_FRAMES=48
PREVIEW_FFMPEG_CONCURRENCY=4
PREVIEW_COMMAND_TIMEOUT_MS=30000

# Global template used for all providers
PREVIEW_VTT_TEMPLATE=https://cdn.example.com/previews/{mediaPath}/thumbnails.vtt

# Optional sprite URL template if your frontend wants a direct sprite URL too
PREVIEW_SPRITE_TEMPLATE=https://cdn.example.com/previews/{mediaPath}/sprite.jpg

# Optional provider-specific overrides
PREVIEW_VTT_TEMPLATE_VIXSRC=https://cdn.example.com/vixsrc/{mediaPath}/thumbs.vtt
PREVIEW_VTT_TEMPLATE_VIDLINK=https://cdn.example.com/vidlink/{mediaPath}/thumbs.vtt

# Optional base URL for relative templates
PREVIEW_BASE_URL=https://cdn.example.com/

# Optional prewarm in TMDB crawler job
PREVIEW_WARMUP_ENABLED=true
PREVIEW_WARMUP_LIMIT=0
PREVIEW_WARMUP_TIMEOUT_MS=20000
PREVIEW_WARMUP_PROVIDERS=vixsrc,vidlink
PREVIEW_WARMUP_TV_ENABLED=true
PREVIEW_WARMUP_TV_SHOW_LIMIT=0
PREVIEW_WARMUP_TV_EPISODES_PER_SHOW=2
```

Supported template tokens:
`{provider}`, `{type}`, `{tmdbId}`, `{season}`, `{episode}`, `{seasonPadded}`, `{episodePadded}`, `{seasonSegment}`, `{episodeSegment}`, `{mediaPath}`

If no external template is configured, `/api/embed/api/streams/[provider]/...` automatically returns:
```json
{
  "preview": {
    "kind": "vtt",
    "vtt": "https://your-backend/api/preview/auto?provider=vidlink&type=movie&tmdbId=123"
  }
}
```

On first request, the backend asks `preview-service` to:
1. Pull frames from the HLS stream through `/api/m3u8-proxy`
2. Build sprite sheets with `ffmpeg`
3. Generate a WebVTT file
4. Cache the results on the shared Docker volume

Generated preview assets are cached by media key (`type + tmdbId (+ season/episode)`), not by provider, so the same movie/episode preview can be reused across `vixsrc` and `vidlink`.

For TV prewarm, crawler resolves episode candidates per show (e.g. `S1E1`, latest aired, then latest-season episodes) and warms up to `PREVIEW_WARMUP_TV_EPISODES_PER_SHOW`.

The backend rewrites sprite URLs inside the VTT file so the frontend can load them through the backend without CORS issues.

## Contributing
We love contributors, it helps the community so much, if you are interested in contributing here are some steps:

1. Clone the repo
```sh
git clone https://github.com/p-stream/backend.git
cd backend
```

2. Install Deps/Run the backend
```sh
npm install && npm run dev
```

3. Set your Environment variables: check above as there is a guide for it!

4. Make your changes! Go crazy, so long as you think it is helpful we'd love to see a Pull Request, have fun, this project is FOSS and done in my our maintainers free time, no pressure, just enjoy yourself

### Philosophy/Habits for devs
Here is a general rule of thumb for what your changes and developments should look like if you plan on getting it merged to the main branch:

- Use Prettier & ESLint: We aren't going to be crazy if it's not well formatted but by using the extensions it keeps our code consistent, which makes it a lot easier for maintainers to help merge your code
- Keep it minimal, things like Email are out of the question, we want to keep it small, if you think that it's **really** needed, make an issue on our GitHub to express your interest in it, and a maintainer will confirm or deny whether we would merge it
- Understand our tech stack, this is a generic piece of advice but if you haven't use NitroJS for example, read their docs and make sure you're familiar with the framework, it makes your code quality much better, and makes reviewing much easier

Star this repo and please follow me on [GitHub](https://github.com/FifthWit)!
