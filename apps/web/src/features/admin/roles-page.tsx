import { zodResolver } from "@hookform/resolvers/zod";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  CORE_PERMISSIONS,
  holderOnlyBeyond,
  type ListRolesQuery,
  type Permission,
  type RoleDto,
  SYSTEM_ROLE_REQUIRED_PERMISSIONS,
  type UpdateRoleInput,
  updateRoleSchema,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { CheckboxGroup } from "@/components/ui/checkbox-group";
import { DataTable, Pagination, SortTh, Th } from "@/components/ui/data-table";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Badge, SearchInput } from "@/components/ui/form-controls";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/use-me";
import { apiErrorMessage } from "@/lib/api";
import { nextSearch } from "@/lib/list-search";
import { useCreateRole, useDeleteRole, usePermissionCatalog, useRoles, useUpdateRole } from "./api";

const route = getRouteApi("/admin/roles");

export function RolesPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const setSearch = (patch: Partial<ListRolesQuery>) =>
    void navigate({ search: nextSearch(search, patch), replace: true });
  const q = useRoles(search);
  const [editing, setEditing] = useState<RoleDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleDto | null>(null);
  const remove = useDeleteRole();
  const sortProps = {
    sort: search.sort,
    order: search.order,
    onSort: (sort: typeof search.sort, order: typeof search.order) => setSearch({ sort, order }),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Vai trò và quyền</h1>
        <Button onClick={() => setEditing("new")}>Thêm vai trò</Button>
      </div>
      <SearchInput
        className="max-w-xs"
        placeholder="Tìm theo tên hoặc mô tả"
        aria-label="Tìm vai trò"
        value={search.q ?? ""}
        onChange={(text) => setSearch({ q: text })}
      />
      <DataTable
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
      >
        <thead className="border-b bg-neutral-50">
          <tr>
            <SortTh field="name" label="Vai trò" {...sortProps} />
            <Th>Mô tả</Th>
            <Th className="text-right">Số quyền</Th>
            <Th className="text-right">Số người</Th>
            <Th>Thao tác</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.items.map((r) => (
            <tr key={r.id} className="border-b align-top last:border-0">
              <td className="p-3">
                {r.name} {r.isSystem ? <Badge tone="muted">Hệ thống</Badge> : null}
              </td>
              <td className="p-3 text-neutral-600">{r.description || "—"}</td>
              <td className="p-3 text-right tabular-nums">{r.permissions.length}</td>
              <td className="p-3 text-right tabular-nums">{r.userCount}</td>
              <td className="p-3">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                    Sửa
                  </Button>
                  {!r.isSystem ? (
                    <Button size="sm" variant="outline" onClick={() => setDeleting(r)}>
                      Xóa
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {remove.error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(remove.error)}
        </p>
      ) : null}
      {q.data ? (
        <Pagination
          page={q.data.page}
          pageSize={q.data.pageSize}
          total={q.data.total}
          onPage={(page) => setSearch({ page })}
        />
      ) : null}
      <Dialog
        open={editing !== null}
        title={editing === "new" ? "Thêm vai trò" : editing ? `Sửa vai trò: ${editing.name}` : ""}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <RoleForm role={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={`Xóa vai trò ${deleting?.name ?? ""}`}
        message={
          deleting?.userCount
            ? `Vai trò đang gán cho ${deleting.userCount} người: gỡ vai trò khỏi họ trước khi xóa.`
            : "Vai trò bị xóa hẳn, không khôi phục được."
        }
        confirmLabel="Xóa vai trò"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function RoleForm({ role, onClose }: { role: RoleDto | null; onClose: () => void }) {
  const me = useMe();
  const catalog = usePermissionCatalog();
  const create = useCreateRole();
  const update = useUpdateRole();
  const mutation = role ? update : create;
  const form = useForm<UpdateRoleInput>({
    // Một schema cho cả tạo và sửa (khi tạo, version bị bỏ qua lúc gửi).
    resolver: zodResolver(updateRoleSchema),
    defaultValues: {
      name: role?.name ?? "",
      description: role?.description ?? "",
      permissions: role?.permissions ?? [],
      version: role?.version ?? 1,
    },
  });
  const errors = form.formState.errors;
  const myPermissions = me.data?.permissions ?? [];
  // Quyền quản trị mình chưa có: không cấp được (backend cũng chặn). Vai trò hệ thống: không gỡ quyền bắt buộc.
  // Vai trò mình đang giữ: không sửa quyền (BR-A7). Vai trò hệ thống: chỉ quyền quản trị (BR-A6).
  const ownRole = Boolean(role && me.data?.roles.some((r) => r.id === role.id));
  const locked = (p: Permission) =>
    ownRole ||
    holderOnlyBeyond(myPermissions, [p]).length > 0 ||
    Boolean(
      role?.isSystem && (SYSTEM_ROLE_REQUIRED_PERMISSIONS.includes(p) || !Object.hasOwn(CORE_PERMISSIONS, p)),
    );

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) =>
        role
          ? update.mutate({ id: role.id, ...v }, { onSuccess: onClose })
          : create.mutate(
              { name: v.name, description: v.description, permissions: v.permissions },
              { onSuccess: onClose },
            ),
      )}
    >
      <Field label="Tên vai trò" error={errors.name?.message}>
        <Input {...form.register("name")} readOnly={role?.isSystem} />
      </Field>
      <Field label="Mô tả" error={errors.description?.message}>
        <Input {...form.register("description")} />
      </Field>
      {ownRole ? (
        <p className="text-xs text-neutral-500">Bạn đang giữ vai trò này nên không sửa được quyền của nó.</p>
      ) : null}
      {role?.isSystem ? (
        <p className="text-xs text-neutral-500">
          Vai trò hệ thống: không đổi tên, không xóa, luôn giữ quyền quản lý người dùng và vai trò, chỉ chứa
          quyền quản trị.
        </p>
      ) : null}
      <Controller
        control={form.control}
        name="permissions"
        render={({ field }) => (
          <div className="max-h-80 space-y-4 overflow-y-auto">
            {catalog.isPending ? (
              <p className="text-sm text-neutral-500">Đang tải danh mục quyền...</p>
            ) : null}
            {catalog.data?.map((g) => (
              <fieldset key={g.group} className="space-y-2">
                <legend className="text-sm font-medium">{g.group}</legend>
                <CheckboxGroup
                  value={field.value as Permission[]}
                  onChange={field.onChange}
                  options={g.items.map((i) => ({
                    value: i.key,
                    label: i.label,
                    disabled: locked(i.key),
                    hint: holderOnlyBeyond(myPermissions, [i.key]).length
                      ? "Quyền quản trị bạn chưa có"
                      : undefined,
                  }))}
                />
              </fieldset>
            ))}
          </div>
        )}
      />
      {mutation.error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(mutation.error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
    </form>
  );
}
