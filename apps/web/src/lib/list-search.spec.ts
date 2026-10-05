import { describe, expect, it } from "vitest";
import { listUsersQuerySchema } from "@app/shared";
import { nextSearch, searchValidator } from "./list-search";

const base = { page: 3, pageSize: 20, sort: "createdAt" as const, order: "desc" as const, q: "giấy" };

describe("nextSearch", () => {
  it("đổi bộ lọc thì quay về trang 1", () =>
    expect(nextSearch(base, { q: "bút" })).toEqual({ ...base, q: "bút", page: 1 }));
  it("chỉ đổi trang thì giữ bộ lọc", () =>
    expect(nextSearch(base, { page: 4 })).toEqual({ ...base, page: 4 }));
  it("xóa từ khóa thì bỏ khỏi URL", () => {
    const { q: _q, ...rest } = base;
    expect(nextSearch(base, { q: "" })).toEqual({ ...rest, page: 1 });
  });
});

describe("searchValidator", () => {
  const validate = searchValidator(listUsersQuerySchema);
  it("đọc tham số hợp lệ từ URL", () =>
    expect(validate({ page: 2, sort: "email", order: "asc" })).toMatchObject({ page: 2, sort: "email" }));
  it("URL sai (cột sắp xếp lạ) thì về mặc định, không làm hỏng trang", () =>
    expect(validate({ sort: "password_hash" })).toEqual(listUsersQuerySchema.parse({})));
});
