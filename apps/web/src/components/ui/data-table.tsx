import type { ReactNode } from "react";
import type { SortOrder } from "@app/shared";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { Card } from "./card";

/**
 * Khung bảng dữ liệu có đủ trạng thái đang tải / lỗi (kèm thử lại) / rỗng (rule frontend: mọi danh sách phải có đủ).
 * Nội dung bảng (thead, tbody) do trang tự vẽ trong `children`.
 */
export function DataTable({
  isPending,
  error,
  onRetry,
  isEmpty,
  emptyText = "Không có dữ liệu.",
  children,
}: {
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  isEmpty: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      {isPending ? (
        <p className="p-6 text-sm text-neutral-500">Đang tải...</p>
      ) : error ? (
        <p role="alert" className="p-6 text-sm text-red-600">
          Không tải được dữ liệu.{" "}
          <button className="underline" onClick={onRetry}>
            Thử lại
          </button>
        </p>
      ) : isEmpty ? (
        <p className="p-6 text-sm text-neutral-500">{emptyText}</p>
      ) : (
        <table className="w-full text-sm">{children}</table>
      )}
    </Card>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("p-3 text-left font-medium", className)}>{children}</th>;
}

/** Tiêu đề cột bấm để sắp xếp: bấm lần đầu giảm dần, bấm lại đảo chiều. `aria-sort` cho trình đọc màn hình. */
export function SortTh<S extends string>({
  field,
  label,
  sort,
  order,
  onSort,
  className,
}: {
  field: S;
  label: string;
  sort: S;
  order: SortOrder;
  onSort: (sort: S, order: SortOrder) => void;
  className?: string;
}) {
  const active = sort === field;
  return (
    <th
      className={cn("p-3 text-left font-medium", className)}
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        className="inline-flex items-center gap-1 hover:underline"
        onClick={() => onSort(field, active && order === "desc" ? "asc" : "desc")}
      >
        {label}
        <span aria-hidden className="text-neutral-400">
          {active ? (order === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 1) return <p className="text-sm text-neutral-500">{total} dòng</p>;
  return (
    <nav aria-label="Phân trang" className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Trang trước
      </Button>
      <span>
        Trang {page} / {pages} · {total} dòng
      </span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Trang sau
      </Button>
    </nav>
  );
}
