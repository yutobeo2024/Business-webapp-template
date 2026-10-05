# <Tên dự án>

Web app quản lý quy trình nghiệp vụ cho <khách hàng>.

## Tạo dự án

Dự án tạo từ [business-webapp-kit](https://github.com/yutobeo2024/Business-webapp-kit) theo một trong hai cách:

- Trên GitHub: "Use this template" ở repo `Business-webapp-template` (nên chọn Private), clone về, rồi
  `pnpm project:setup` một lần: kiểm Node 22/24, tạo `.env` với tên DB và Redis riêng theo tên thư mục dự án.
- Dòng lệnh: `install.sh` / `install.ps1` trong repo kit (tự chạy `project:setup`).

Sau đó sửa phần `<...>` ở đầu README này và trong `CLAUDE.md`. Phiên bản kit ghi trong `.kit.json` (nâng cấp bằng
`kit-sync` của repo kit rồi `/kit-upgrade`).

## Chạy môi trường dev

Yêu cầu: Node 24 (xem `.nvmrc`), pnpm 10 (`corepack enable`), Docker.

```bash
pnpm project:setup                # lần đầu: tạo .env (DB/Redis riêng của dự án); rồi đổi SEED_ADMIN_PASSWORD
pnpm install
pnpm exec playwright install chromium  # in PDF ở worker, test tích hợp worker và E2E
pnpm dev:services                 # PostgreSQL + Redis
pnpm build
pnpm db:reset-local dev           # tạo DB dev của dự án, migrate, seed: vai trò mặc định, quản trị + tài khoản demo
                                  # (mật khẩu = SEED_ADMIN_PASSWORD). Sau đó dùng pnpm db:migrate khi có migration mới.
pnpm db:reset-local               # tạo DB test của dự án (TEST_DATABASE_URL)
pnpm dev                          # API :3000, web :5173
```

Đăng nhập bằng `SEED_ADMIN_EMAIL`: menu Người dùng, Vai trò, Phòng ban để tạo tài khoản thật và cấu hình quyền.

## Kiểm tra

```bash
pnpm verify:quick                                             # lint + typecheck + unit test
pnpm test:integration                                         # DB và Redis thật (TEST_DATABASE_URL, TEST_REDIS_URL)
pnpm claude:selftest                                          # tự kiểm hook Claude Code
```

## Tài liệu

- Làm việc với Claude Code: `CLAUDE.md`, `.claude/`
- Trước khi giao khách: `docs/PRODUCTION-CHECKLIST.md`
- Nghiệp vụ: `docs/specs/`. Kiến trúc: `docs/adr/`. Vận hành: `docs/runbooks/`
