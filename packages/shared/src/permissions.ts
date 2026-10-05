import { z } from "zod";
import { PR_PERMISSIONS } from "./purchase-request.js"; // sample

/**
 * Danh mục QUYỀN của hệ thống. Quyền khai báo trong mã (vì chỉ có nghĩa khi có mã thực thi nó); VAI TRÒ là tập quyền do
 * quản trị viên cấu hình trên giao diện và lưu trong DB (ADR-0004).
 *
 * Mã kiểm quyền bằng `can(user, "...")`, KHÔNG BAO GIỜ kiểm tên vai trò.
 * Module mới: khai báo `XXX_PERMISSIONS` trong file shared của module (cùng dạng CORE_PERMISSIONS) rồi thêm vào `PERMISSIONS`
 * dưới đây; quyền tự xuất hiện trong màn chỉnh vai trò.
 */
export interface PermissionDef {
  /** Nhóm hiển thị trên màn chỉnh vai trò. */
  group: string;
  /** Mô tả tiếng Việt, nói rõ quyền cho phép làm gì. */
  label: string;
  /**
   * Quyền quản trị: chỉ người ĐANG CÓ quyền này mới cấp được cho người khác (qua vai trò), và người không có nó không
   * thao tác được trên tài khoản đang có nó (không đặt lại mật khẩu để chiếm tài khoản mạnh hơn mình).
   * Quyền nghiệp vụ thì người quản lý tài khoản gán được dù bản thân không có (tách biệt nhiệm vụ).
   */
  holderOnly?: boolean;
}

export const CORE_PERMISSIONS = {
  "users.manage": {
    group: "Quản trị hệ thống",
    label: "Quản lý người dùng: tạo, sửa, khóa tài khoản, đặt lại mật khẩu",
    holderOnly: true,
  },
  "roles.manage": { group: "Quản trị hệ thống", label: "Quản lý vai trò và quyền", holderOnly: true },
  "departments.manage": { group: "Quản trị hệ thống", label: "Quản lý phòng ban", holderOnly: true },
} as const satisfies Record<string, PermissionDef>;

export const PERMISSIONS = {
  ...CORE_PERMISSIONS,
  ...PR_PERMISSIONS, // sample
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as [Permission, ...Permission[]];
export const permissionSchema = z.enum(PERMISSION_KEYS, "Quyền không tồn tại");

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** Người dùng có quyền này không. Dùng chung cho backend (quyết định thật) và frontend (ẩn/hiện nút). */
export function can(
  user: { permissions: readonly string[] } | null | undefined,
  permission: Permission,
): boolean {
  return Boolean(user?.permissions.includes(permission));
}

/** Quyền quản trị (holderOnly) mà người dùng chưa có trong danh sách quyền cho trước. Rỗng = không vượt quyền. */
export function holderOnlyBeyond(
  actorPermissions: readonly string[],
  permissions: Iterable<string>,
): Permission[] {
  const out = new Set<Permission>();
  for (const p of permissions) {
    if (!isPermission(p)) continue;
    const def: PermissionDef = PERMISSIONS[p];
    if (def.holderOnly && !actorPermissions.includes(p)) out.add(p);
  }
  return [...out].sort();
}

/** Quyền của vai trò hệ thống "Quản trị hệ thống": luôn có, không gỡ được (tránh tự khóa mình ra khỏi hệ thống). */
export const SYSTEM_ROLE_REQUIRED_PERMISSIONS: readonly Permission[] = ["users.manage", "roles.manage"];

/** Danh mục theo nhóm, để vẽ màn chỉnh vai trò. */
export function permissionGroups(): { group: string; items: { key: Permission; label: string }[] }[] {
  const groups = new Map<string, { key: Permission; label: string }[]>();
  for (const key of PERMISSION_KEYS) {
    const def: PermissionDef = PERMISSIONS[key];
    groups.set(def.group, [...(groups.get(def.group) ?? []), { key, label: def.label }]);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}
