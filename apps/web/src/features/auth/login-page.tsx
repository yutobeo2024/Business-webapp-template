import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { type CurrentUser, type LoginInput, loginSchema } from "@app/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { meQueryKey } from "./use-me";

export function LoginPage() {
  const qc = useQueryClient();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const login = useMutation({
    mutationFn: (body: LoginInput) => api<CurrentUser>("/auth/login", { method: "POST", body }),
    onSuccess: (user) => qc.setQueryData(meQueryKey, user),
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Đăng nhập</h1>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
          <Field label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" {...form.register("email")} />
          </Field>
          <Field label="Mật khẩu" error={form.formState.errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...form.register("password")} />
          </Field>
          {login.error ? (
            <p role="alert" className="text-sm text-red-600">
              {login.error instanceof ApiError ? login.error.message : "Không kết nối được máy chủ"}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Đang đăng nhập..." : "Đăng nhập"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
