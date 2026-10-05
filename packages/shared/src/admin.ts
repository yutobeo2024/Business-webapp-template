/**
 * Quản trị người dùng, vai trò, phòng ban (lõi của kit, spec docs/specs/000-quan-tri-nguoi-dung.md).
 */
import { optionalPhoneSchema } from "./notifications.js";
import { z } from "zod";
import { listQuerySchema } from "./api.js";
import { passwordSchema } from "./auth.js";
import { type Permission, permissionSchema } from "./permissions.js";

const version = z.number().int().min(1);
const name = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} không được trống`).max(max, `${label} tối đa ${max} ký tự`);

// ---------- Phòng ban ----------

export const createDepartmentSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Mã phòng ban gồm chữ không dấu, số, - hoặc _, tối đa 20 ký tự"),
  name: name("Tên phòng ban"),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: name("Tên phòng ban"),
  isActive: z.boolean(),
  version,
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

export const listDepartmentsQuerySchema = listQuerySchema({
  sortable: ["code", "name", "createdAt"],
  defaultSort: "code",
  defaultOrder: "asc",
}).extend({ status: z.enum(["active", "inactive"]).optional() });
export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
  version: number;
}

// ---------- Vai trò ----------

const permissionList = z
  .array(permissionSchema)
  .max(500)
  .transform((list) => [...new Set(list)].sort() as Permission[]);

export const createRoleSchema = z.object({
  name: name("Tên vai trò", 100),
  description: z.string().trim().max(500, "Mô tả tối đa 500 ký tự").default(""),
  permissions: permissionList,
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.extend({ version });
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const listRolesQuerySchema = listQuerySchema({
  sortable: ["name", "createdAt"],
  defaultSort: "name",
  defaultOrder: "asc",
});
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;

export interface RoleDto {
  id: string;
  name: string;
  description: string;
  /** Vai trò "Quản trị hệ thống": không xóa, không đổi tên, luôn giữ quyền quản trị người dùng và vai trò. */
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
  version: number;
}

// ---------- Người dùng ----------

const roleIds = z
  .array(z.uuid())
  .max(20, "Tối đa 20 vai trò")
  .transform((ids) => [...new Set(ids)]);

export const createUserSchema = z.object({
  email: z
    .email("Email không hợp lệ")
    .max(200)
    .transform((v) => v.trim().toLowerCase()),
  fullName: name("Họ tên"),
  /** Để gửi thông báo Zalo; để trống nếu không dùng. */
  phone: optionalPhoneSchema.optional(),
  departmentId: z.uuid().nullable(),
  roleIds,
  /** Mật khẩu tạm: người dùng bắt buộc đổi ở lần đăng nhập đầu. */
  temporaryPassword: passwordSchema,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: name("Họ tên"),
  /** Không gửi trường này thì giữ nguyên số cũ. */
  phone: optionalPhoneSchema.optional(),
  departmentId: z.uuid().nullable(),
  roleIds,
  version,
});
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({ isActive: z.boolean(), version });
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

export const resetPasswordSchema = z.object({ temporaryPassword: passwordSchema, version });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const USER_STATUSES = ["active", "inactive", "locked"] as const;
export const USER_STATUS_LABELS: Record<(typeof USER_STATUSES)[number], string> = {
  active: "Đang hoạt động",
  inactive: "Đã khóa",
  locked: "Tạm khóa do đăng nhập sai",
};

export const listUsersQuerySchema = listQuerySchema({
  sortable: ["fullName", "email", "createdAt"],
  defaultSort: "fullName",
  defaultOrder: "asc",
}).extend({
  departmentId: z.uuid().optional(),
  roleId: z.uuid().optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  /** Dạng 84xxxxxxxxx; hiển thị bằng formatPhone. */
  phone: string | null;
  departmentId: string | null;
  departmentName: string | null;
  roles: { id: string; name: string }[];
  isActive: boolean;
  mustChangePassword: boolean;
  /** Tạm khóa do đăng nhập sai tới thời điểm này (ISO), null nếu không. */
  lockedUntil: string | null;
  createdAt: string;
  version: number;
}

/** Dữ liệu cho form người dùng: vai trò (kèm có được gán không, theo quy tắc chống leo thang quyền) và phòng ban. */
export interface UserFormOptions {
  roles: { id: string; name: string; assignable: boolean }[];
  departments: { id: string; code: string; name: string }[];
}
