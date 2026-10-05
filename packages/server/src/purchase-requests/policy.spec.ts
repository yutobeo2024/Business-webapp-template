import { describe, expect, it } from "vitest";
import type { Permission } from "@app/shared";
import { canView, viewScope } from "./policy.js";

const pr = { requesterId: "u1", departmentId: "kd" };
const u = (id: string, departmentId: string | null, permissions: Permission[] = []) => ({
  id,
  departmentId,
  permissions,
});

describe("BR-07 phạm vi xem dữ liệu theo quyền", () => {
  it("không có quyền xem rộng: chỉ xem phiếu của mình", () => {
    expect(canView(viewScope(u("u1", "kd", ["pr.create"])), pr)).toBe(true);
    expect(canView(viewScope(u("u2", "kd", ["pr.create"])), pr)).toBe(false);
  });
  it("pr.view.department: xem phiếu cùng phòng ban", () => {
    expect(canView(viewScope(u("m1", "kd", ["pr.view.department"])), pr)).toBe(true);
    expect(canView(viewScope(u("m2", "kt", ["pr.view.department"])), pr)).toBe(false);
  });
  it("pr.view.department nhưng chưa gán phòng ban: chỉ xem phiếu của mình", () =>
    expect(viewScope(u("m3", null, ["pr.view.department"]))).toEqual({ kind: "own", userId: "m3" }));
  it("pr.view.all: xem tất cả, kể cả không thuộc phòng ban nào", () =>
    expect(canView(viewScope(u("d", null, ["pr.view.all"])), pr)).toBe(true));
  it("quản trị hệ thống không có quyền nghiệp vụ: không xem phiếu của người khác", () =>
    expect(canView(viewScope(u("a", null, ["users.manage", "roles.manage"])), pr)).toBe(false));
});
