import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  can,
  listDepartmentsQuerySchema,
  listPurchaseRequestsQuerySchema, // sample
  listRolesQuerySchema,
  listUsersQuerySchema,
  type Permission,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { ChangePasswordPage } from "@/features/account/change-password-page";
import { DepartmentsPage } from "@/features/admin/departments-page";
import { RolesPage } from "@/features/admin/roles-page";
import { UsersPage } from "@/features/admin/users-page";
import { LoginPage } from "@/features/auth/login-page";
import { meQueryKey, useMe } from "@/features/auth/use-me";
import { ExportsPage } from "@/features/exports/exports-page";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { NotificationsPage } from "@/features/notifications/notifications-page";
import { NotificationSettingsPage } from "@/features/notifications/settings-page";
import { HomePage } from "@/features/home/home-page";
import { PurchaseRequestListPage } from "@/features/purchase-requests/list-page"; // sample
import { api } from "@/lib/api";
import { searchValidator } from "@/lib/list-search";

/** Mục điều hướng: chỉ hiện khi người dùng có quyền. Quyền thật do backend kiểm ở từng endpoint. */
const NAV: { to: string; label: string; permission?: Permission }[] = [
  { to: "/", label: "Trang chủ" },
  { to: "/purchase-requests", label: "Phiếu đề nghị" }, // sample
  { to: "/exports", label: "Tệp đã xuất" },
  { to: "/admin/users", label: "Người dùng", permission: "users.manage" },
  { to: "/admin/roles", label: "Vai trò", permission: "roles.manage" },
  { to: "/admin/departments", label: "Phòng ban", permission: "departments.manage" },
];

function AppShell() {
  const me = useMe();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    // Chỉ khi server đã xóa phiên. Lỗi mạng mà vẫn xóa trạng thái thì phiên còn sống, F5 là vào lại.
    onSuccess: () => {
      qc.setQueryData(meQueryKey, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
    },
  });

  if (me.isPending) return <p className="p-6 text-sm text-neutral-500">Đang tải...</p>;
  if (me.isError)
    return (
      <p role="alert" className="p-6 text-sm text-red-600">
        Không kết nối được máy chủ.{" "}
        <button className="underline" onClick={() => me.refetch()}>
          Thử lại
        </button>
      </p>
    );
  if (!me.data) return <LoginPage />;
  if (me.data.mustChangePassword) return <ChangePasswordPage forced />;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 p-4">
          <nav className="flex flex-wrap items-center gap-4">
            <span className="font-semibold">Quản lý quy trình</span>
            {NAV.filter((n) => !n.permission || can(me.data, n.permission)).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="text-sm text-neutral-600 hover:text-neutral-900"
                activeProps={{ className: "font-medium text-neutral-900 underline underline-offset-4" }}
                activeOptions={{ exact: n.to === "/", includeSearch: false }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <NotificationBell />
            <Link to="/account/password" className="hover:underline">
              {me.data.fullName}
              {me.data.roles.length ? ` · ${me.data.roles.map((r) => r.name).join(", ")}` : ""}
            </Link>
            <Button size="sm" variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Đăng xuất
            </Button>
            {logout.isError ? (
              <span role="alert" className="text-red-600">
                Chưa đăng xuất được, thử lại
              </span>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Outlet />
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
function Home() {
  const me = useMe();
  const links = NAV.filter((n) => n.to !== "/" && (!n.permission || can(me.data, n.permission)));
  return <HomePage links={links} />;
}
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home });
// sample:begin
const purchaseRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/purchase-requests",
  validateSearch: searchValidator(listPurchaseRequestsQuerySchema),
  component: PurchaseRequestListPage,
});
// sample:end
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: NotificationsPage,
});
const exportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/exports",
  component: ExportsPage,
});
const accountNotificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/notifications",
  component: NotificationSettingsPage,
});
const accountPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/password",
  component: () => <ChangePasswordPage />,
});

/** Trang chỉ hiện khi có quyền (mở thẳng URL mà không có quyền thì báo, thay vì một bảng toàn lỗi 403). */
function RequirePermission({ permission, page }: { permission: Permission; page: ReactNode }) {
  const me = useMe();
  if (!can(me.data, permission)) {
    return <p className="text-sm text-neutral-600">Bạn không có quyền xem trang này.</p>;
  }
  return page;
}

const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/users",
  validateSearch: searchValidator(listUsersQuerySchema),
  component: () => <RequirePermission permission="users.manage" page={<UsersPage />} />,
});
const adminRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/roles",
  validateSearch: searchValidator(listRolesQuerySchema),
  component: () => <RequirePermission permission="roles.manage" page={<RolesPage />} />,
});
const adminDepartmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/departments",
  validateSearch: searchValidator(listDepartmentsQuerySchema),
  component: () => <RequirePermission permission="departments.manage" page={<DepartmentsPage />} />,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    homeRoute,
    purchaseRequestsRoute, // sample
    exportsRoute,
    notificationsRoute,
    accountPasswordRoute,
    accountNotificationsRoute,
    adminUsersRoute,
    adminRolesRoute,
    adminDepartmentsRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
