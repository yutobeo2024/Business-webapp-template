---
paths:
  - "**/*.spec.ts"
  - "**/*.int.spec.ts"
  - "e2e/**"
---

# Kiểm thử

- Unit (`*.spec.ts`): Vitest, cho hàm thuần (state machine, policy, schema, format).
- Tích hợp (`*.int.spec.ts`): PostgreSQL + Redis THẬT qua `test/helpers.ts` (`openDb`, `resetDb`, `seedFixture`,
  `makeUser`). Không mock luồng ghi DB. Test lõi chỉ dùng tính năng lõi (chạy được sau `pnpm sample:remove`); module có
  fixture riêng.
- E2E (`e2e/`): Playwright, cho tiêu chí nghiệm thu chính của từng lát có giao diện. Tài khoản từ `pnpm db:seed -- --demo`,
  khai báo trong `e2e/users.ts`; mở trang bằng `pageAs("vai-tro")` (phiên lưu sẵn bởi `auth.setup.ts`). Không đăng nhập lại
  trong từng test (giới hạn 10 lần/phút mỗi IP), không bấm Đăng xuất. Chạy lại nhiều lần trên cùng DB phải vẫn xanh: dữ
  liệu tạo trong test mang dấu thời gian (tên, mã), không dựa vào trạng thái DB dev; cần DB demo mới thì `pnpm db:reset-local dev`.
- Tên test là hành vi tiếng Việt và dẫn mã quy tắc: `it("BR-02: trưởng phòng khác phòng ban bị chặn")`.
- Cấm: xóa hoặc `.skip` test đang đỏ, sửa assertion cho khớp kết quả sai, hạ ngưỡng kiểm tra để qua CI.
