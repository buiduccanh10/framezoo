# Shared nginx-proxy and ACME companion

Stack nay chay doc lap khoi cac project ung dung. Moi project chi can attach
vao network external `betakiot_proxy_network` va khai bao `VIRTUAL_HOST`,
`VIRTUAL_PORT`, `ACME_HOST`, `ACME_EMAIL`.

## 1. Backup va kiem tra VPS

Chay tren VPS. Khong dung `docker compose down -v`.

```bash
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect nginx-proxy nginx-proxy-acme
docker inspect -f '{{range .Mounts}}{{println .Destination .Name}}{{end}}' nginx-proxy-acme
docker volume ls | grep -E 'nginx|acme'
docker network inspect betakiot_proxy_network
```

Ghi lai ten volume dang duoc mount tai `/etc/nginx/certs`, `/etc/nginx/vhost.d`
va `/usr/share/nginx/html`. Dat cac ten do vao `ops/nginx-proxy/.env`.

Backup cert volume truoc khi thay container:

```bash
CERT_VOLUME=betakiot_nginx_certs
mkdir -p /root/nginx-proxy-backup
docker run --rm \
  -v "$CERT_VOLUME:/src:ro" \
  -v /root/nginx-proxy-backup:/backup \
  alpine:3.20 \
  tar czf /backup/nginx-certs-$(date -u +%Y%m%dT%H%M%SZ).tgz -C /src .
```

Neu ten volume khac `betakiot_nginx_certs`, sua `CERT_VOLUME` theo ten thuc te.
Lap lai cho `vhost` va `html` neu can.

Compose cu khong persist `/etc/acme.sh`. Sao luu account state neu thu muc nay
ton tai trong container cu:

```bash
docker cp nginx-proxy-acme:/etc/acme.sh \
  /root/nginx-proxy-backup/acme.sh 2>/dev/null || true
```

## 2. Kiem tra DNS outbound

```bash
docker exec nginx-proxy-acme cat /etc/resolv.conf
docker exec nginx-proxy-acme getent hosts acme-v02.api.letsencrypt.org
docker exec nginx-proxy-acme sh -c \
  'curl -4fsS --max-time 15 https://acme-v02.api.letsencrypt.org/directory'
```

`curl error 6` nghia la container khong resolve duoc hostname. Kiem tra them:

```bash
getent hosts acme-v02.api.letsencrypt.org
curl -4fsS --max-time 15 https://acme-v02.api.letsencrypt.org/directory
```

Neu host resolve duoc nhung container khong resolve duoc, giu `dns` trong
compose nay. Neu VPS chan `1.1.1.1` hoac `8.8.8.8`, thay bang DNS resolver cua
provider. Neu Docker daemon van cap DNS loi cho cac container khac, them DNS
vao `/etc/docker/daemon.json`, giu lai cac key dang co, sau do:

```bash
sudo systemctl restart docker
```

Lenh nay restart Docker va cac container tren VPS. Thuc hien trong maintenance
window.

## 3. Tao network va volume external

Neu network cu dang la network Compose-managed, tao lai sau khi stop proxy cu:

```bash
docker network inspect betakiot_proxy_network >/dev/null 2>&1 || \
  docker network create --driver bridge --attachable betakiot_proxy_network
```

Tao volume moi chi khi `docker volume inspect` xac nhan no chua ton tai. Dung
dung ten da dat trong `ops/nginx-proxy/.env`:

```bash
CERT_VOLUME=betakiot_nginx_certs
VHOST_VOLUME=betakiot_nginx_vhost
HTML_VOLUME=betakiot_nginx_html
ACME_VOLUME=nginx_proxy_acme

for volume in "$CERT_VOLUME" "$VHOST_VOLUME" "$HTML_VOLUME" "$ACME_VOLUME"; do
  docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume"
done
```

Neu da sao luu account state, restore vao volume ACME moi:

```bash
ACME_VOLUME=nginx_proxy_acme
docker run --rm \
  -v "$ACME_VOLUME:/dst" \
  -v /root/nginx-proxy-backup:/backup:ro \
  alpine:3.20 \
  sh -c 'test -d /backup/acme.sh && cp -a /backup/acme.sh/. /dst/ || true'
```

Khong xoa volume cert cu.

## 4. Chuyen proxy sang stack manual

Copy `.env.example` thanh `.env`, sua ten volume theo buoc 1, sau do chay:

```bash
cd /opt/framezoo/ops/nginx-proxy
cp .env.example .env
docker compose config --quiet
```

Stop va xoa chi hai container proxy cu. Khong xoa volume:

```bash
docker rm -f nginx-proxy-acme nginx-proxy 2>/dev/null || true
```

Khoi dong stack manual:

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=200 nginx-proxy-acme
```

## 5. Khoi dong cac project ung dung

`BetaKiot` phai dung `proxy_network` external co ten
`betakiot_proxy_network`. `FrameZoo` da dung external network nay.

```bash
cd /opt/BetaKiot
docker compose -f docker-compose.prod.yml up -d --remove-orphans

cd /opt/framezoo
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

Khong khai bao lai `nginx-proxy` hoac `nginx-proxy-acme` trong cac compose ung
dung. Chi service app moi khai bao `VIRTUAL_HOST` va `ACME_HOST`.

## 5.1. Vhost override (vi du: client_max_body_size)

File trong `ops/nginx-proxy/vhost.d/<hostname>` se duoc nginx-proxy include vao
server block cua vhost do. Vi du `vhost.d/api.framezoo.top` chua
`client_max_body_size 20m;` (can thiet de `/api/subtitle-align` nhan upload WAV
~2MB, nginx mac dinh gioi han 1MB).

Volume `nginx_vhost` la volume named chia se, nen phai copy file vao trong
volume (khong mount bind duoc):

```bash
VHOST_VOLUME=betakiot_nginx_vhost
docker run --rm \
  -v "$VHOST_VOLUME:/vhost.d" \
  -v /opt/framezoo/ops/nginx-proxy/vhost.d:/src:ro \
  alpine:3.20 \
  sh -c 'cp -a /src/. /vhost.d/'
```

Sau do restart `nginx-proxy` de docker-gen regenerate config (docker-gen chi
chay lai khi co Docker event, khong watch file trong vhost.d) va reload nginx:

```bash
docker restart nginx-proxy
```

Khong du chi `docker exec nginx-proxy nginx -s reload` — dong
`include /etc/nginx/vhost.d/...` chi duoc render vao config khi docker-gen
generate, reload thuan tuy khong them include vao config cu.

Kiem tra config da co hieu luc:

```bash
docker exec nginx-proxy sh -c 'grep -rn client_max_body_size /etc/nginx/conf.d/'
```

## 6. Verify

```bash
docker network inspect betakiot_proxy_network
docker exec nginx-proxy-acme getent hosts acme-v02.api.letsencrypt.org
docker exec nginx-proxy-acme sh -c \
  'curl -4fsS --max-time 15 https://acme-v02.api.letsencrypt.org/directory'
docker logs --tail=200 nginx-proxy
docker logs --tail=200 nginx-proxy-acme
```

Kiem tra tung hostname tu ben ngoai VPS:

```bash
curl -I http://framezoo.top
curl -I https://framezoo.top
curl -I https://api.framezoo.top
openssl s_client -connect framezoo.top:443 -servername framezoo.top \
  </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

Neu DNS trong container da work nhung ACME van fail, kiem tra A/AAAA record cua
tung domain, firewall cloud, port 80/443, va HTTP-01 challenge co truy cap duoc
tu Internet. Dac biet, AAAA tro sai se lam Let's Encrypt ket noi IPv6 sai.
