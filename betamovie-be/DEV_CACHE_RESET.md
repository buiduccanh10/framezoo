# Clear Cache Trong Dev Mode

Tai lieu nay huong dan xoa cache cho backend khi chay local/dev:
- Nitro cache tren filesystem (`.nitro/cache`)
- Redis cache hien tai (storage `cache`)

## 1) Clear Nitro filesystem cache

Dung khi ban thay du lieu cu bi luu trong `.nitro/cache` (dac biet khi dev khong dung Redis hoac Redis mount sai).

```bash
rm -rf .nitro/cache
```

Sau do restart dev server:

```bash
pnpm run dev
```

## 2) Clear Redis cache (an toan theo prefix)

Khuyen nghi xoa theo prefix de khong anh huong key khac:

- `embed:*`
- `tmdb:*`
- `tmdb_catalog_*`

### Cach A: Redis chay local (redis-cli tren may)

```bash
redis-cli --scan --pattern 'embed:*' | xargs -r redis-cli del
redis-cli --scan --pattern 'tmdb:*' | xargs -r redis-cli del
redis-cli --scan --pattern 'tmdb_catalog_*' | xargs -r redis-cli del
```

### Cach B: Redis chay trong Docker Compose

```bash
docker compose exec redis redis-cli --scan --pattern 'embed:*' | xargs -r docker compose exec -T redis redis-cli del
docker compose exec redis redis-cli --scan --pattern 'tmdb:*' | xargs -r docker compose exec -T redis redis-cli del
docker compose exec redis redis-cli --scan --pattern 'tmdb_catalog_*' | xargs -r docker compose exec -T redis redis-cli del
```

> Neu dung file compose khac, them `-f docker-compose.prod.yml`.

## 3) Clear toan bo Redis DB (chi dung khi can)

Chi dung khi ban chac chan Redis nay chi phuc vu environment dev.

### Local redis-cli

```bash
redis-cli FLUSHDB
```

### Docker Compose

```bash
docker compose exec redis redis-cli FLUSHDB
```

## 4) Verify da clear cache

### Kiem tra so key Redis

```bash
redis-cli DBSIZE
```

hoac voi Docker:

```bash
docker compose exec redis redis-cli DBSIZE
```

### Kiem tra log runtime

Sau khi clear, request dau tien se la `Cache miss`, request tiep theo moi co `Serving from cache`.

## 5) Quick reset (thuong dung nhat cho dev)

```bash
rm -rf .nitro/cache
redis-cli FLUSHDB
pnpm run dev
```

Neu Redis chay trong Docker:

```bash
rm -rf .nitro/cache
docker compose exec redis redis-cli FLUSHDB
pnpm run dev
```
