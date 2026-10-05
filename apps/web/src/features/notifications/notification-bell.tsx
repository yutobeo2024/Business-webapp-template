import { Link } from "@tanstack/react-router";
import { useUnreadCount } from "./api";

/** Chuông trên thanh menu: số thông báo chưa đọc, bấm để mở trang Thông báo. */
export function NotificationBell() {
  const q = useUnreadCount();
  const n = q.data?.count ?? 0;
  const label = n > 0 ? `Thông báo (${n} chưa đọc)` : "Thông báo";
  return (
    <Link
      to="/notifications"
      aria-label={label}
      title={label}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded hover:bg-neutral-100"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs leading-5 text-white">
          {n > 99 ? "99+" : n}
        </span>
      ) : null}
    </Link>
  );
}
