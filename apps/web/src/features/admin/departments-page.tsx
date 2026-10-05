import { zodResolver } from "@hookform/resolvers/zod";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  type CreateDepartmentInput,
  createDepartmentSchema,
  type DepartmentDto,
  type ListDepartmentsQuery,
  type UpdateDepartmentInput,
  updateDepartmentSchema,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, SortTh, Th } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Badge, Checkbox, SearchInput, Select } from "@/components/ui/form-controls";
import { Input } from "@/components/ui/input";
import { ImportButton } from "@/features/imports/import-dialog";
import { apiErrorMessage } from "@/lib/api";
import { nextSearch } from "@/lib/list-search";
import { useCreateDepartment, useDepartments, useUpdateDepartment } from "./api";

const route = getRouteApi("/admin/departments");

export function DepartmentsPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const setSearch = (patch: Partial<ListDepartmentsQuery>) =>
    void navigate({ search: nextSearch(search, patch), replace: true });
  const q = useDepartments(search);
  const [editing, setEditing] = useState<DepartmentDto | "new" | null>(null);
  const sortProps = {
    sort: search.sort,
    order: search.order,
    onSort: (sort: typeof search.sort, order: typeof search.order) => setSearch({ sort, order }),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Phòng ban</h1>
        <div className="flex gap-2">
          <ImportButton type="departments" invalidate={["admin", "departments"]} />
          <Button onClick={() => setEditing("new")}>Thêm phòng ban</Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Tìm theo mã hoặc tên"
          aria-label="Tìm phòng ban"
          value={search.q ?? ""}
          onChange={(text) => setSearch({ q: text })}
        />
        <Select
          aria-label="Lọc trạng thái"
          value={search.status ?? ""}
          onChange={(e) =>
            setSearch({ status: (e.target.value || undefined) as ListDepartmentsQuery["status"] })
          }
        >
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang dùng</option>
          <option value="inactive">Ngừng dùng</option>
        </Select>
      </div>
      <DataTable
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
      >
        <thead className="border-b bg-neutral-50">
          <tr>
            <SortTh field="code" label="Mã" {...sortProps} />
            <SortTh field="name" label="Tên phòng ban" {...sortProps} />
            <Th className="text-right">Số người</Th>
            <Th>Trạng thái</Th>
            <Th>Thao tác</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.items.map((d) => (
            <tr key={d.id} className="border-b last:border-0">
              <td className="p-3 font-mono">{d.code}</td>
              <td className="p-3">{d.name}</td>
              <td className="p-3 text-right tabular-nums">{d.userCount}</td>
              <td className="p-3">
                <Badge tone={d.isActive ? "green" : "muted"}>{d.isActive ? "Đang dùng" : "Ngừng dùng"}</Badge>
              </td>
              <td className="p-3">
                <Button size="sm" variant="outline" onClick={() => setEditing(d)}>
                  Sửa
                </Button>
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
      <Dialog
        open={editing !== null}
        title={editing === "new" ? "Thêm phòng ban" : editing ? `Sửa phòng ban ${editing.code}` : ""}
        onClose={() => setEditing(null)}
      >
        {editing === "new" ? (
          <CreateDepartmentForm onClose={() => setEditing(null)} />
        ) : editing ? (
          <EditDepartmentForm department={editing} onClose={() => setEditing(null)} />
        ) : null}
      </Dialog>
    </div>
  );
}

function CreateDepartmentForm({ onClose }: { onClose: () => void }) {
  const create = useCreateDepartment();
  const form = useForm<CreateDepartmentInput>({
    resolver: zodResolver(createDepartmentSchema),
    defaultValues: { code: "", name: "" },
  });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) => create.mutate(v, { onSuccess: onClose }))}
    >
      <Field label="Mã phòng ban" error={form.formState.errors.code?.message}>
        <Input className="font-mono uppercase" {...form.register("code")} />
      </Field>
      <Field label="Tên phòng ban" error={form.formState.errors.name?.message}>
        <Input {...form.register("name")} />
      </Field>
      <FormFooter error={create.error} pending={create.isPending} onClose={onClose} />
    </form>
  );
}

function EditDepartmentForm({ department, onClose }: { department: DepartmentDto; onClose: () => void }) {
  const update = useUpdateDepartment();
  const form = useForm<UpdateDepartmentInput>({
    resolver: zodResolver(updateDepartmentSchema),
    defaultValues: { name: department.name, isActive: department.isActive, version: department.version },
  });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={form.handleSubmit((v) => update.mutate({ id: department.id, ...v }, { onSuccess: onClose }))}
    >
      <Field label="Tên phòng ban" error={form.formState.errors.name?.message}>
        <Input {...form.register("name")} />
      </Field>
      <Checkbox
        label="Đang dùng (bỏ chọn: không gán được người mới vào phòng ban này)"
        {...form.register("isActive")}
      />
      <FormFooter error={update.error} pending={update.isPending} onClose={onClose} />
    </form>
  );
}

function FormFooter({ error, pending, onClose }: { error: unknown; pending: boolean; onClose: () => void }) {
  return (
    <>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {apiErrorMessage(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Hủy bỏ
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
    </>
  );
}
