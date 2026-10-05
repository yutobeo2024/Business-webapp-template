import { Link, useNavigate } from "@tanstack/react-router";
import { formatDateTime } from "@app/shared";
import { useMe } from "@/features/auth/use-me";
import { useMarkRead, useNotifications } from "@/features/notifications/api";

/**
 * Trang chủ (lõi): lời chào, thông báo chưa đọc gần nhất, lối tắt tới các mục người dùng được dùng. Module nghiệp vụ thêm
 * lối tắt của mình qua `links` ở router (cùng danh sách menu).
 */
export function HomePage({ links }: { links: { to: string; label: string }[] }) {
  const me = useMe();
  const unread = useNotifications({ page: 1, pageSize: 5, unread: true });
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const items = unread.data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Xin chào {me.data?.fullName}</h1>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Thông báo chưa đọc</h2>
          <Link to="/notifications" className="text-sm underline">
            Xem tất cả
          </Link>
        </div>
        {unread.isPending ? <p className="text-sm text-neutral-500">Đang tải...</p> : null}
        {unread.data && items.length === 0 ? (
          <p className="text-sm text-neutral-500">Không có thông báo chưa đọc.</p>
        ) : null}
        <ul className="divide-y rounded border bg-white">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="block w-full p-3 text-left hover:bg-neutral-50"
                onClick={() => {
                  markRead.mutate(n.id);
                  if (n.link) void navigate({ href: n.link });
                }}
              >
                <span className="block text-sm font-semibold">{n.title}</span>
                <span className="block text-sm text-neutral-700">{n.body}</span>
                <span className="block text-xs text-neutral-500">{formatDateTime(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {links.length ? (
        <section className="space-y-2">
          <h2 className="font-medium">Lối tắt</h2>
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="rounded border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
