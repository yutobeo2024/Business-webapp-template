// Chạy: node --test scripts/project-setup.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEnv, redisIndexes, slugify } from "./project-setup.mjs";

test("tên thư mục thành định danh DB: bỏ dấu tiếng Việt, đ, ký tự lạ; bắt đầu bằng chữ; tối đa 40 ký tự", () => {
  assert.equal(slugify("Quản Lý Kho Đồng Nai"), "quan_ly_kho_dong_nai");
  assert.equal(slugify("tam-ung"), "tam_ung");
  assert.equal(slugify("2026 Dự án"), "app_2026_du_an");
  assert.equal(slugify("a".repeat(60)).length, 40);
  assert.match(slugify("x--".repeat(20)), /^[a-z0-9_]*[a-z0-9]$/);
});

test("chỉ số Redis: dev 1-7, test 8-15, ổn định theo tên", () => {
  for (const n of ["tam_ung", "kho", "app_2026"]) {
    const r = redisIndexes(n);
    assert.ok(r.dev >= 1 && r.dev <= 7 && r.test >= 8 && r.test <= 15);
    assert.deepEqual(redisIndexes(n), r);
  }
});

test(".env: thay đúng DB và Redis mẫu, giữ nguyên phần còn lại (kể cả xuống dòng CRLF)", () => {
  const example = [
    "# chú thích",
    "DATABASE_URL=postgresql://app:app@localhost:5432/app_dev",
    "REDIS_URL=redis://localhost:6379/1",
    "TEST_DATABASE_URL=postgresql://app:app@localhost:5432/app_test",
    "TEST_REDIS_URL=redis://localhost:6379/15",
    "SEED_ADMIN_PASSWORD=doi-mat-khau-nay-ngay",
    "",
  ];
  const r = redisIndexes("kho_ha_noi");
  for (const eol of ["\n", "\r\n"]) {
    const out = buildEnv(example.join(eol), "Kho Hà Nội");
    assert.equal(
      out,
      [
        "# chú thích",
        "DATABASE_URL=postgresql://app:app@localhost:5432/kho_ha_noi_dev",
        `REDIS_URL=redis://localhost:6379/${r.dev}`,
        "TEST_DATABASE_URL=postgresql://app:app@localhost:5432/kho_ha_noi_test",
        `TEST_REDIS_URL=redis://localhost:6379/${r.test}`,
        "SEED_ADMIN_PASSWORD=doi-mat-khau-nay-ngay",
        "",
      ].join(eol),
    );
  }
});
