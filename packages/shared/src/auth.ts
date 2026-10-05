import { z } from "zod";
import { permissionSchema } from "./permissions.js";

export const loginSchema = z.object({
  email: z
    .email("Email không hợp lệ")
    .max(200)
    .transform((v) => v.trim().toLowerCase()),
  // Chỉ kiểm độ dài tối thiểu để chặn request rỗng; chính sách mật khẩu áp dụng lúc ĐẶT mật khẩu, không lúc đăng nhập.
  password: z.string().min(1, "Nhập mật khẩu").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  departmentId: z.uuid().nullable(),
  roles: z.array(z.object({ id: z.uuid(), name: z.string() })),
  /** Hợp quyền của mọi vai trò. Chỉ chứa quyền có trong danh mục hiện tại. */
  permissions: z.array(permissionSchema),
  /** Tài khoản đang dùng mật khẩu tạm: chỉ được đổi mật khẩu, đăng xuất. */
  mustChangePassword: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Chính sách mật khẩu, dùng chung lúc tạo tài khoản, đặt lại và tự đổi. */
export const PASSWORD_MIN = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Mật khẩu tối thiểu ${PASSWORD_MIN} ký tự`)
  .max(128, "Mật khẩu tối đa 128 ký tự");

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Nhập mật khẩu hiện tại").max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "Mật khẩu mới phải khác mật khẩu hiện tại",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Mật khẩu không được chứa phần tên của email (ví dụ nguyenvana@... thì không dùng "nguyenvana2026"). */
export function passwordContainsEmail(password: string, email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return local.length >= 4 && password.toLowerCase().includes(local);
}
