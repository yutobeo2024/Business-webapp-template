import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { formatDateTime, type NotificationDto } from "@app/shared";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/data-table";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMarkAllRead, useMarkRead, useNotifications } from "./api";

/** Thông báo của tôi (spec 003). Bấm vào một thông báo: đánh dấu đã đọc rồi mở trang liên quan. */
export function NotificationsPage() {
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const q = useNotifications({ page, pageSize: 20, unread });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const error = apiErrorMessage(q.error) ?? apiErrorMessage(markAll.error) ?? apiErrorMessage(markRead.error);

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) void navigate({ href: n.link });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Thông báo</h1>
        <div className="flex items-center gap-2">
          <Link to="/account/notifications" className="text-sm underline">
            Cài đặt
          </Link>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={unread}
            onClick={() => {
              setUnread(!unread);
              setPage(1);
            }}
          >
            {unread ? "Xem tất cả" : "Chỉ chưa đọc"}
          </Button>
          <Button size="sm" variant="outline" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            Đánh dấu tất cả đã đọc
          </Button>
        </div>
      </div>

      {q.isPending ? <p className="text-sm text-neutral-500">Đang tải...</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}{" "}
          <button className="underline" onClick={() => void q.refetch()}>
            Thử lại
          </button>
        </p>
      ) : null}
      {q.data && q.data.items.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {unread ? "Không có thông báo chưa đọc." : "Chưa có thông báo nào."}
        </p>
      ) : null}

      <ul className="divide-y rounded border bg-white">
        {q.data?.items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => open(n)}
              className={cn("block w-full p-3 text-left hover:bg-neutral-50", !n.readAt && "bg-blue-50/60")}
            >
              <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
              <span className="block text-sm text-neutral-700">{n.body}</span>
              <span className="block text-xs text-neutral-500">{formatDateTime(n.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
      ) : null}
    </div>
  );
}
