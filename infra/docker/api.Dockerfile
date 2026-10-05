# syntax=docker/dockerfile:1.7
# Image production cho @app/api. Build từ GỐC repo: docker build -f infra/docker/api.Dockerfile .
# Các bước đã được kiểm chứng: turbo prune -> cài frozen lockfile -> build -> pnpm deploy chỉ dependency production.

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.6 turbo@2.11.6 && npm cache clean --force
WORKDIR /repo

FROM base AS prune
COPY . .
RUN rm -rf out && turbo prune @app/api --docker

FROM base AS build
COPY --from=prune /repo/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ .
RUN turbo run build --filter=@app/api... \
 && pnpm --filter @app/api deploy --legacy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Thư mục tệp (compose mount thư mục host vào đây). Gỡ npm/corepack đi kèm image node: lúc chạy chỉ cần node, còn npm
# mang theo dependency riêng hay dính lỗ hổng (trivy image báo HIGH dù app không dùng).
# apk upgrade: lấy bản vá bảo mật mới hơn image gốc.
RUN apk upgrade --no-cache \
 && mkdir -p /data/files && chown node:node /data/files \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV STORAGE_DIR=/data/files
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
