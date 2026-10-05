import { describe, expect, it } from "vitest";
import { listUsersQuerySchema } from "@app/shared";
import { escapeLike } from "./list-query.js";

describe("escapeLike", () => {
  it("ký tự đại diện của LIKE được tìm như chữ thường", () => {
    expect(escapeLike(String.raw`50%_a\b`)).toBe(String.raw`50\%\_a\\b`);
  });
});

describe("listQuerySchema (qua danh sách người dùng)", () => {
  it("mặc định: trang 1, 20 dòng, sắp theo mặc định của màn hình, không tìm", () =>
    expect(listUsersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "fullName",
      order: "asc",
    }));
  it("tham số từ URL (chuỗi) được chuyển kiểu; từ khóa rỗng coi như không tìm", () =>
    expect(listUsersQuerySchema.parse({ page: "2", q: "  ", sort: "email", order: "desc" })).toEqual({
      page: 2,
      pageSize: 20,
      sort: "email",
      order: "desc",
    }));
  it("cột sắp xếp ngoài danh sách cho phép bị từ chối (không bao giờ vào SQL)", () => {
    const r = listUsersQuerySchema.safeParse({ sort: "password_hash" });
    expect(r.success).toBe(false);
  });
});
