# ADR-0001: Stack kỹ thuật

- Ngày: 2026-10-02
- Trạng thái: Chấp nhận

## Bối cảnh

Web app quy trình nghiệp vụ cho doanh nghiệp, đội nhỏ phát triển với AI agent, bảo trì nhiều năm, chi phí vận hành thấp.

## Quyết định

- **TypeScript đầu cuối, Zod schema dùng chung FE/BE**: sửa một trường thì typecheck chỉ ra mọi nơi bị ảnh hưởng, AI tự sửa được.
- **NestJS 12 (ESM)**: quy ước module/DI/guard chặt, AI bám khuôn tốt. NestJS 12 chỉ hỗ trợ ESM nên toàn repo dùng ESM.
- **Drizzle ORM thay Prisma**: không cần engine nhị phân (image nhỏ, không lỗi musl), schema là TypeScript, migration là SQL đọc được.
- **PostgreSQL 17, Redis 7 + BullMQ**: transaction chắc, khóa dòng; job nền có retry.
- **React 19 + Vite (SPA)**: app sau đăng nhập không cần SSR/SEO; tránh lớp cache ngầm của framework full-stack.
- **TypeScript 6.0**: typescript-eslint chưa hỗ trợ TypeScript 7. Nâng khi hỗ trợ (dùng `/upgrade-deps`).
- **Node 24 LTS** cho production.

## Phương án đã cân nhắc

Next.js full-stack (nhanh cho dự án rất nhỏ nhưng ranh giới FE/BE mờ); Prisma (engine nhị phân, khó kiểm migration không có DB);
Jenkins (phải nuôi server CI riêng, GitHub Actions đủ dùng).

## Hệ quả

Import tương đối phải có đuôi `.js`. Test NestJS dùng SWC để giữ decorator metadata.
