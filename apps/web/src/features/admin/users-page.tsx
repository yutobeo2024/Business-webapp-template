import { zodResolver } from "@hookform/resolvers/zod";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  type CreateUserInput,
  createUserSchema,
  formatDateTime,
  type ListUsersQuery,
  type UpdateUserInput,
  updateUserSchema,
  USER_STATUS_LABELS,
  USER_STATUSES,
  type UserDto,
  formatPhone,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { CheckboxGroup } from "@/components/ui/checkbox-group";
import { DataTable, Pagination, SortTh, Th } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Badge, SearchInput, Select } from "@/components/ui/form-controls";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/use-me";
import { ExportButton } from "@/features/exports/export-button";
import { apiErrorMessage } from "@/lib/api";
import { nextSearch } from "@/lib/list-search";
import { generateTemporaryPassword } from "@/lib/password";
import {
  useCreateUser,
  useResetPassword,
  useSetUserActive,
  useUnlockUser,
  useUpdateUser,
  useUserOptions,
  useUsers,
} from "./api";

const route = getRouteApi("/admin/users");

function statusOf(u: UserDto): { label: string; tone: "green" | "red" | "orange" } {
  if (!u.isActive) return { label: USER_STATUS_LABELS.inactive, tone: "red" };
  if (u.lockedUntil) return { label: USER_STATUS_LABELS.locked, tone: "orange" };
  return { label: USER_STATUS_LABELS.active, tone: "green" };
}

export function UsersPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const setSearch = (patch: Partial<ListUsersQuery>) =>
    void navigate({ search: nextSearch(search, patch), replace: true });
  const q = useUsers(search);
  const options = useUserOptions();
  const [editing, setEditing] = useState<UserDto | "new" | null>(null);
  const sortProps = {
    sort: search.sort,
    order: search.order,
    onSort: (sort: typeof search.sort, order: typeof search.order) => setSearch({ sort, order }),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Người dùng</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Xuất đúng bộ lọc và thứ tự đang xem (không phân trang). */}
          <ExportButton
            label="Xuất Excel"
            input={{
              type: "admin.users.xlsx",
              params: {
                q: search.q,
                departmentId: search.departmentId,
                roleId: search.roleId,
                status: search.status,
                sort: search.sort,
                order: search.order,
              },
            }}
          />
          <Button onClick={() => setEditing("new")}>Thêm người dùng</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Tìm theo tên hoặc email"
          aria-label="Tìm người dùng"
          value={search.q ?? ""}
          onChange={(text) => setSearch({ q: text })}
        />
        <Select
          aria-label="Lọc phòng ban"
          value={search.departmentId ?? ""}
          onChange={(e) => setSearch({ departmentId: e.target.value || undefined })}
        >
          <option value="">Mọi phòng ban</option>
          {options.data?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Lọc vai trò"
          value={search.roleId ?? ""}
          onChange={(e) => setSearch({ roleId: e.target.value || undefined })}
        >
          <option value="">Mọi vai trò</option>
          {options.data?.roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Lọc trạng thái"
          value={search.status ?? ""}
          onChange={(e) => setSearch({ status: (e.target.value || undefined) as ListUsersQuery["status"] })}
        >
          <option value="">Mọi trạng thái</option>
          {USER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {USER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
        emptyText="Không có người dùng nào khớp bộ lọc."
      >
        <thead className="border-b bg-neutral-50">
          <tr>
            <SortTh field="fullName" label="Họ tên" {...sortProps} />
            <SortTh field="email" label="Email" {...sortProps} />
            <Th>Phòng ban</Th>
            <Th>Vai trò</Th>
            <Th>Trạng thái</Th>
            <SortTh field="createdAt" label="Ngày tạo" {...sortProps} />
            <Th>Thao tác</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.items.map((u) => (
            <tr key={u.id} className="border-b align-top last:border-0">
              <td className="p-3">
                {u.fullName}
                {u.mustChangePassword ? (
                  <p className="text-xs text-neutral-500">Đang dùng mật khẩu tạm</p>
                ) : null}
              </td>
              <td className="p-3">{u.email}</td>
              <td className="p-3">{u.departmentName ?? "—"}</td>
              <td className="p-3">{u.roles.map((r) => r.name).join(", ") || "—"}</td>
              <td className="p-3">
                <Badge tone={statusOf(u).tone}>{statusOf(u).label}</Badge>
              </td>
              <td className="p-3 whitespace-nowrap">{formatDateTime(u.createdAt)}</td>
              <td className="p-3">
                <UserActions user={u} onEdit={() => setEditing(u)} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {q.data ? (
        <Pagination
          page={q.data.page}
          pageSize={q.data.pageSize}
          total={q.data.total}
          onPage={(page) => setSearch({ page })}
        />
      ) : null}
      <UserFormDialog user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function UserActions({ user, onEdit }: { user: UserDto; onEdit: () => void }) {
  const me = useMe();
  const isSelf = me.data?.id === user.id;
  const setActive = useSetUserActive();
  const unlock = useUnlockUser();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const error = apiErrorMessage(setActive.error) ?? apiErrorMessage(unlock.error);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={onEdit}>
        Sửa
      </Button>
      {/* Không tự khóa / tự đặt lại mật khẩu (backend cũng chặn). */}
      {!isSelf ? (
        <>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            {user.isActive ? "Khóa" : "Mở khóa"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setResetting(true)}>
            Đặt lại mật khẩu
          </Button>
        </>
      ) : null}
      {user.lockedUntil ? (
        <Button
          size="sm"
          variant="outline"
          disabled={unlock.isPending}
          onClick={() => unlock.mutate(user.id)}
        >
          Gỡ tạm khóa
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`${user.isActive ? "Khóa" : "Mở khóa"} tài khoản ${user.email}`}
        message={
          user.isActive
            ? "Người này bị đăng xuất ngay và không đăng nhập được cho tới khi mở khóa. Dữ liệu của họ được giữ nguyên."
            : "Người này đăng nhập lại được với mật khẩu hiện có."
        }
        confirmLabel={user.isActive ? "Khóa tài khoản" : "Mở khóa"}
        destructive={user.isActive}
        pending={setActive.isPending}
        onConfirm={() =>
          setActive.mutate(
            { id: user.id, isActive: !user.isActive, version: user.version },
            { onSettled: () => setConfirming(false) },
          )
        }
        onClose={() => setConfirming(false)}
      />
      <ResetPasswordDialog user={user} open={resetting} onClose={() => setResetting(false)} />
    </div>
  );
}

function ResetPasswordDialog({ user, open, onClose }: { user: UserDto; open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title={`Đặt lại mật khẩu: ${user.email}`} onClose={onClose}>
      <ResetPasswordBody user={user} onClose={onClose} />
    </Dialog>
  );
}

function ResetPasswordBody({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const reset = useResetPassword();
  const [password] = useState(generateTemporaryPassword);
  const [done, setDone] = useState(false);
  if (done) {
    return (
      <>
        <p className="text-sm">
          Mật khẩu tạm (chỉ hiện một lần, gửi riêng cho người dùng):{" "}
          <code className="rounded bg-neutral-100 px-2 py-1 font-mono">{password}</code>
        </p>
        <p className="text-sm text-neutral-600">Người dùng phải đặt mật khẩu mới ở lần đăng nhập tới.</p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-neutral-700">
        Mọi phiên đăng nhập của người này bị đăng xuất ngay. Hệ thống tạo mật khẩu tạm ngẫu nhiên, người dùng
        phải đổi ở lần đăng nhập tới.
      </p>
      {reset.error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(reset.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button
          variant="destructive"
          disabled={reset.isPending}
          onClick={() =>
            reset.mutate(
              { id: user.id, temporaryPassword: password, version: user.version },
              { onSuccess: () => setDone(true) },
            )
          }
        >
          Đặt lại mật khẩu
        </Button>
      </div>
    </>
  );
}

/** Tạo (user = "new") hoặc sửa người dùng. Hiện mật khẩu tạm một lần sau khi tạo. */
function UserFormDialog({ user, onClose }: { user: UserDto | "new" | null; onClose: () => void }) {
  const title = user === "new" ? "Thêm người dùng" : user ? `Sửa: ${user.email}` : "";
  return (
    <Dialog open={user !== null} title={title} onClose={onClose}>
      {user === "new" ? (
        <CreateUserForm onClose={onClose} />
      ) : user ? (
        <EditUserForm user={user} onClose={onClose} />
      ) : null}
    </Dialog>
  );
}

function CreateUserForm({ onClose }: { onClose: () => void }) {
  const create = useCreateUser();
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const form = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      fullName: "",
      phone: "",
      departmentId: null,
      roleIds: [],
      temporaryPassword: generateTemporaryPassword(),
    },
  });
  if (created) {
    return (
      <>
        <p className="text-sm">
          Đã tạo tài khoản <strong>{created.email}</strong>. Mật khẩu tạm (chỉ hiện một lần):{" "}
          <code className="rounded bg-neutral-100 px-2 py-1 font-mono">{created.password}</code>
        </p>
        <p className="text-sm text-neutral-600">Người dùng phải đặt mật khẩu mới ở lần đăng nhập đầu tiên.</p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Đóng</Button>
        </div>
      </>
    );
  }
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) =>
        create.mutate(v, {
          onSuccess: (u) => setCreated({ email: u.email, password: String(v.temporaryPassword) }),
        }),
      )}
    >
      <Field label="Email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="off" {...form.register("email")} />
      </Field>
      <Field label="Mật khẩu tạm" error={form.formState.errors.temporaryPassword?.message}>
        <Input autoComplete="off" className="font-mono" {...form.register("temporaryPassword")} />
      </Field>
      <Field label="Họ tên" error={form.formState.errors.fullName?.message}>
        <Input {...form.register("fullName")} />
      </Field>
      <Field
        label="Số di động (nhận thông báo Zalo, có thể để trống)"
        error={form.formState.errors.phone?.message}
      >
        <Input inputMode="tel" autoComplete="off" {...form.register("phone")} />
      </Field>
      <Field label="Phòng ban" error={form.formState.errors.departmentId?.message}>
        <DepartmentSelect {...form.register("departmentId", departmentValue)} />
      </Field>
      <Controller
        control={form.control}
        name="roleIds"
        render={({ field }) => <RoleChecklist value={field.value} onChange={field.onChange} />}
      />
      {create.error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(create.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Đang lưu..." : "Tạo tài khoản"}
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const update = useUpdateUser();
  const me = useMe();
  const form = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      fullName: user.fullName,
      phone: user.phone ? formatPhone(user.phone) : "",
      departmentId: user.departmentId,
      roleIds: user.roles.map((r) => r.id),
      version: user.version,
    },
  });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) => update.mutate({ id: user.id, ...v }, { onSuccess: onClose }))}
    >
      <Field label="Họ tên" error={form.formState.errors.fullName?.message}>
        <Input {...form.register("fullName")} />
      </Field>
      <Field
        label="Số di động (nhận thông báo Zalo, có thể để trống)"
        error={form.formState.errors.phone?.message}
      >
        <Input inputMode="tel" autoComplete="off" {...form.register("phone")} />
      </Field>
      <Field label="Phòng ban" error={form.formState.errors.departmentId?.message}>
        <DepartmentSelect
          {...form.register("departmentId", departmentValue)}
          disabled={me.data?.id === user.id}
          title={me.data?.id === user.id ? "Không tự đổi phòng ban của mình" : undefined}
        />
      </Field>
      <Controller
        control={form.control}
        name="roleIds"
        render={({ field }) => (
          <RoleChecklist value={field.value} disabled={me.data?.id === user.id} onChange={field.onChange} />
        )}
      />
      {update.error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(update.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
    </form>
  );
}

/** Ô chọn phòng ban đang dùng (giá trị rỗng = không thuộc phòng ban). */
function DepartmentSelect(props: Parameters<typeof Select>[0]) {
  const options = useUserOptions();
  return (
    <Select className="w-full" {...props}>
      <option value="">Không thuộc phòng ban</option>
      {options.data?.departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.code} · {d.name}
        </option>
      ))}
    </Select>
  );
}

/** Danh sách vai trò để gán. Vai trò chứa quyền quản trị mình chưa có thì không chọn được (backend cũng chặn). */
function RoleChecklist({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const options = useUserOptions();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Vai trò</legend>
      {disabled ? <p className="text-xs text-neutral-500">Không tự đổi vai trò của chính mình.</p> : null}
      <CheckboxGroup
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={(options.data?.roles ?? []).map((r) => ({
          value: r.id,
          label: r.name,
          disabled: !r.assignable && !value.includes(r.id),
          hint: r.assignable ? undefined : "Chứa quyền quản trị bạn chưa có",
        }))}
      />
    </fieldset>
  );
}

/** Phòng ban: chuỗi rỗng của thẻ select thành null (schema nhận uuid hoặc null). */
const departmentValue = { setValueAs: (v: string | null) => v || null };
