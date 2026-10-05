import { describe, expect, it } from "vitest";
import {
  can,
  holderOnlyBeyond,
  isPermission,
  PERMISSION_KEYS,
  permissionGroups,
  PERMISSIONS,
} from "./permissions.js";

describe("danh mục quyền", () => {
  it("can() chỉ đúng khi người dùng có đúng quyền đó", () => {
    expect(can({ permissions: ["departments.manage"] }, "departments.manage")).toBe(true);
    expect(can({ permissions: ["departments.manage"] }, "users.manage")).toBe(false);
    expect(can(null, "departments.manage")).toBe(false);
  });

  it("isPermission nhận đúng khóa trong danh mục, không nhận khóa lạ hay thuộc tính của Object", () => {
    expect(isPermission("users.manage")).toBe(true);
    expect(isPermission("module_da_go.x")).toBe(false);
    expect(isPermission("toString")).toBe(false);
  });

  it("mọi quyền có nhãn tiếng Việt và nằm trong đúng một nhóm", () => {
    const grouped = permissionGroups().flatMap((g) => g.items.map((i) => i.key));
    expect(grouped.sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const key of PERMISSION_KEYS) expect(PERMISSIONS[key].label.length).toBeGreaterThan(5);
  });
});

describe("holderOnlyBeyond (chống leo thang quyền quản trị)", () => {
  it("quyền quản trị mình chưa có thì bị liệt kê; quyền nghiệp vụ thì không", () => {
    expect(holderOnlyBeyond(["users.manage"], ["users.manage", "roles.manage", "nghiep.vu.bat.ky"])).toEqual([
      "roles.manage",
    ]);
  });
  it("có đủ quyền quản trị thì rỗng; khóa lạ bị bỏ qua", () =>
    expect(holderOnlyBeyond(["users.manage", "roles.manage"], ["roles.manage", "khong.ton.tai"])).toEqual(
      [],
    ));
});
