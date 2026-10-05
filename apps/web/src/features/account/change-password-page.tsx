import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { type ChangePasswordInput, changePasswordSchema, PASSWORD_MIN } from "@app/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { meQueryKey } from "@/features/auth/use-me";
import { api, ApiError } from "@/lib/api";

/**
 * Đổi mật khẩu. `forced`: tài khoản đang dùng mật khẩu tạm do quản trị viên đặt, AppShell chỉ hiện màn này
 * (API khác trả 403 cho tới khi đổi xong).
 */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });
  const change = useMutation({
    mutationFn: (body: ChangePasswordInput) => api<void>("/auth/change-password", { method: "POST", body }),
    onSuccess: () => {
      form.reset();
      setDone(true);
      // Tải lại me: mustChangePassword về false, AppShell mở lại toàn bộ ứng dụng.
      void qc.invalidateQueries({ queryKey: meQueryKey });
    },
  });
  const errors = form.formState.errors;

  return (
    <div className={forced ? "flex min-h-screen items-center justify-center p-4" : ""}>
      <Card className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">{forced ? "Đặt mật khẩu mới" : "Đổi mật khẩu"}</h1>
        {forced ? (
          <p className="text-sm text-neutral-600">
            Tài khoản của bạn đang dùng mật khẩu tạm do quản trị viên cấp. Hãy đặt mật khẩu mới để tiếp tục.
          </p>
        ) : null}
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
          <Field
            label={forced ? "Mật khẩu tạm" : "Mật khẩu hiện tại"}
            error={errors.currentPassword?.message}
          >
            <Input type="password" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field label="Mật khẩu mới" error={errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...form.register("newPassword")} />
          </Field>
          <p className="text-xs text-neutral-500">
            Tối thiểu {PASSWORD_MIN} ký tự, không chứa tên đăng nhập. Đổi xong, các phiên đăng nhập khác của
            bạn bị đăng xuất.
          </p>
          {change.error ? (
            <p role="alert" className="text-sm text-red-600">
              {change.error instanceof ApiError ? change.error.message : "Không kết nối được máy chủ"}
            </p>
          ) : null}
          {done && !forced ? (
            <p role="status" className="text-sm text-green-700">
              Đã đổi mật khẩu.
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={change.isPending}>
            {change.isPending ? "Đang lưu..." : "Lưu mật khẩu mới"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
