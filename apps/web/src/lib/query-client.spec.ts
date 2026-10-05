import { describe, expect, it } from "vitest";
import { meQueryKey } from "@/features/auth/use-me";
import { ApiError } from "./api";
import { createQueryClient } from "./query-client";

const user = {
  id: "u",
  email: "a@b.vn",
  fullName: "A",
  departmentId: null,
  roles: [],
  permissions: [],
  mustChangePassword: false,
};

describe("createQueryClient", () => {
  it("query nhận 401 (hết phiên) thì xóa người dùng hiện tại để hiện trang đăng nhập", async () => {
    const qc = createQueryClient();
    qc.setQueryData(meQueryKey, user);
    await qc
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(new ApiError(401, "UNAUTHENTICATED", "hết phiên")),
      })
      .catch(() => undefined);
    expect(qc.getQueryData(meQueryKey)).toBeNull();
  });

  it("401 xóa luôn dữ liệu đã tải của người dùng cũ (người đăng nhập sau không thấy)", async () => {
    const qc = createQueryClient();
    qc.setQueryData(meQueryKey, user);
    qc.setQueryData(["admin", "users", { page: 1 }], { items: ["dữ liệu của người cũ"] });
    await qc
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(new ApiError(401, "UNAUTHENTICATED", "hết phiên")),
      })
      .catch(() => undefined);
    expect(qc.getQueryData(["admin", "users", { page: 1 }])).toBeUndefined();
  });

  it("mutation nhận 401 cũng xóa người dùng hiện tại", async () => {
    const qc = createQueryClient();
    qc.setQueryData(meQueryKey, user);
    await qc
      .getMutationCache()
      .build(qc, { mutationFn: () => Promise.reject(new ApiError(401, "UNAUTHENTICATED", "hết phiên")) })
      .execute(undefined)
      .catch(() => undefined);
    expect(qc.getQueryData(meQueryKey)).toBeNull();
  });

  it("lỗi khác 401 giữ nguyên người dùng", async () => {
    const qc = createQueryClient();
    qc.setQueryData(meQueryKey, user);
    await qc
      .fetchQuery({ queryKey: ["y"], queryFn: () => Promise.reject(new ApiError(403, "FORBIDDEN", "cấm")) })
      .catch(() => undefined);
    expect(qc.getQueryData(meQueryKey)).toEqual(user);
  });
});
