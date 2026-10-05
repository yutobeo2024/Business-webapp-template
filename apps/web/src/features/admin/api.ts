import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDepartmentInput,
  CreateRoleInput,
  CreateUserInput,
  DepartmentDto,
  ListDepartmentsQuery,
  ListRolesQuery,
  ListUsersQuery,
  Paginated,
  Permission,
  ResetPasswordInput,
  RoleDto,
  SetUserActiveInput,
  UpdateDepartmentInput,
  UpdateRoleInput,
  UpdateUserInput,
  UserDto,
  UserFormOptions,
} from "@app/shared";
import { api } from "@/lib/api";
import { toQueryString } from "@/lib/query-string";

const keys = {
  users: ["admin", "users"] as const,
  roles: ["admin", "roles"] as const,
  departments: ["admin", "departments"] as const,
  // Form người dùng đọc vai trò và phòng ban: đổi một trong hai thì tải lại.
  userOptions: ["admin", "users", "options"] as const,
};

/** Sau khi ghi (kể cả lỗi 409 vì dữ liệu đã đổi): tải lại để người dùng thấy bản mới nhất. */
function useAdminMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  invalidate: readonly (readonly string[])[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// ---------- Người dùng ----------

export function useUsers(params: ListUsersQuery) {
  return useQuery({
    queryKey: [...keys.users, "list", params],
    queryFn: () => api<Paginated<UserDto>>(`/admin/users?${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useUserOptions() {
  return useQuery({
    queryKey: keys.userOptions,
    queryFn: () => api<UserFormOptions>("/admin/users/options"),
  });
}

export const useCreateUser = () =>
  useAdminMutation(
    (body: CreateUserInput) => api<UserDto>("/admin/users", { method: "POST", body }),
    [keys.users],
  );

export const useUpdateUser = () =>
  useAdminMutation(
    ({ id, ...body }: UpdateUserInput & { id: string }) =>
      api<UserDto>(`/admin/users/${id}`, { method: "PATCH", body }),
    [keys.users, keys.roles, keys.departments],
  );

export const useSetUserActive = () =>
  useAdminMutation(
    ({ id, ...body }: SetUserActiveInput & { id: string }) =>
      api<UserDto>(`/admin/users/${id}/active`, { method: "POST", body }),
    [keys.users],
  );

export const useResetPassword = () =>
  useAdminMutation(
    ({ id, ...body }: ResetPasswordInput & { id: string }) =>
      api<UserDto>(`/admin/users/${id}/reset-password`, { method: "POST", body }),
    [keys.users],
  );

export const useUnlockUser = () =>
  useAdminMutation(
    (id: string) => api<UserDto>(`/admin/users/${id}/unlock`, { method: "POST", body: {} }),
    [keys.users],
  );

// ---------- Vai trò ----------

export function useRoles(params: ListRolesQuery) {
  return useQuery({
    queryKey: [...keys.roles, "list", params],
    queryFn: () => api<Paginated<RoleDto>>(`/admin/roles?${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: [...keys.roles, "permissions"],
    queryFn: () =>
      api<{ group: string; items: { key: Permission; label: string }[] }[]>("/admin/permissions"),
    staleTime: Infinity, // danh mục nằm trong mã, chỉ đổi khi phát hành bản mới
  });
}

export const useCreateRole = () =>
  useAdminMutation(
    (body: CreateRoleInput) => api<RoleDto>("/admin/roles", { method: "POST", body }),
    [keys.roles, keys.userOptions],
  );

export const useUpdateRole = () =>
  useAdminMutation(
    ({ id, ...body }: UpdateRoleInput & { id: string }) =>
      api<RoleDto>(`/admin/roles/${id}`, { method: "PATCH", body }),
    [keys.roles, keys.users],
  );

export const useDeleteRole = () =>
  useAdminMutation((id: string) => api<void>(`/admin/roles/${id}`, { method: "DELETE" }), [keys.roles]);

// ---------- Phòng ban ----------

export function useDepartments(params: ListDepartmentsQuery) {
  return useQuery({
    queryKey: [...keys.departments, "list", params],
    queryFn: () => api<Paginated<DepartmentDto>>(`/admin/departments?${toQueryString(params)}`),
    placeholderData: (prev) => prev,
  });
}

export const useCreateDepartment = () =>
  useAdminMutation(
    (body: CreateDepartmentInput) => api<DepartmentDto>("/admin/departments", { method: "POST", body }),
    [keys.departments, keys.userOptions],
  );

export const useUpdateDepartment = () =>
  useAdminMutation(
    ({ id, ...body }: UpdateDepartmentInput & { id: string }) =>
      api<DepartmentDto>(`/admin/departments/${id}`, { method: "PATCH", body }),
    [keys.departments, keys.users],
  );
