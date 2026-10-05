# syntax=docker/dockerfile:1.7
# Image production cho @app/worker. Build từ GỐC repo: docker build -f infra/docker/worker.Dockerfile .
# Các bước đã được kiểm chứng: turbo prune -> cài frozen lockfile -> build -> pnpm deploy chỉ dependency production.
# Debian (không phải Alpine): Chromium để in PDF (ADR-0005) chạy ổn định trên glibc. Build và runtime cùng nền để gói có
# mã native (nếu có) khớp thư viện C.

FROM node:24-bookworm-slim AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 && npm cache clean --force
WORKDIR /repo

FROM base AS prune
COPY . .
RUN rm -rf out && turbo prune @app/worker --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN turbo run build --filter=@app/worker... \
 && pnpm --filter @app/worker deploy --legacy --prod /out

FROM node:24-bookworm-slim AS runtime
# Chromium + font Noto (đủ dấu tiếng Việt) cho PDF. Không tải trình duyệt lúc chạy.
# upgrade: lấy bản vá bảo mật mới hơn image gốc (trivy image chặn HIGH đã có bản vá).
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    STORAGE_DIR=/data/files
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Thư mục tệp (compose mount thư mục host vào đây). Gỡ npm/corepack đi kèm image node: lúc chạy chỉ cần node, còn npm
# mang theo dependency riêng hay dính lỗ hổng (trivy image báo HIGH dù app không dùng).
RUN mkdir -p /data/files && chown node:node /data/files \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER node
# Worker không có cổng HTTP. Docker tự khởi động lại khi tiến trình thoát (restart: unless-stopped).
CMD ["node", "--enable-source-maps", "dist/main.js"]
