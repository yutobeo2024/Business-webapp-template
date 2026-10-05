# syntax=docker/dockerfile:1.7
# Image frontend: build Vite thành file tĩnh, phục vụ bằng Caddy. Build từ GỐC repo.
# Biến VITE_* bị nhúng vào JS lúc build, KHÔNG được chứa secret.

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 && npm cache clean --force
WORKDIR /repo

FROM base AS prune
COPY . .
RUN rm -rf out && turbo prune @app/web --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN turbo run build --filter=@app/web...

FROM caddy:2.11.6-alpine AS runtime
# Không chạy root (trivy AVD-DS-0002): user riêng, nghe cổng 8080 (cổng < 1024 cần quyền root).
# apk upgrade: lấy bản vá bảo mật mới hơn image gốc.
RUN apk upgrade --no-cache \
 && addgroup -S web && adduser -S -G web web \
 && mkdir -p /data /config && chown -R web:web /data /config
COPY --from=build --chown=web:web /repo/apps/web/dist /srv
COPY infra/docker/web.Caddyfile /etc/caddy/Caddyfile
USER web
EXPOSE 8080
