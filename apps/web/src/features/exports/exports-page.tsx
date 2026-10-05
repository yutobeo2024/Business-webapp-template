import { EXPORT_STATUS_LABELS, type ExportStatus, formatDateTime } from "@app/shared";
import { DataTable, Th } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/form-controls";
import { exportDownloadUrl, useMyExports } from "./api";

const TONE: Record<ExportStatus, Parameters<typeof Badge>[0]["tone"]> = {
  QUEUED: "neutral",
  RUNNING: "amber",
  DONE: "green",
  FAILED: "red",
};

/** Tệp đã xuất của chính người dùng (spec 002). Tệp tải được đến khi hết hạn, sau đó cần xuất lại. */
export function ExportsPage() {
  const q = useMyExports();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Tệp đã xuất</h1>
        <p className="text-sm text-neutral-600">
          20 lần xuất gần nhất của bạn. Tệp tự xóa khi hết hạn tải về.
        </p>
      </div>
      <DataTable
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.length === 0}
        emptyText="Bạn chưa xuất tệp nào."
      >
        <thead className="border-b bg-neutral-50">
          <tr>
            <Th>Loại</Th>
            <Th>Trạng thái</Th>
            <Th>Yêu cầu lúc</Th>
            <Th>Hết hạn</Th>
            <Th>Tệp</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((e) => (
            <tr key={e.id} className="border-b align-top last:border-0">
              <td className="p-3">
                {e.label}
                {e.rowCount !== null && e.type.endsWith(".xlsx") ? (
                  <span className="block text-xs text-neutral-500">{e.rowCount} dòng</span>
                ) : null}
              </td>
              <td className="p-3">
                <Badge tone={TONE[e.status]}>{EXPORT_STATUS_LABELS[e.status]}</Badge>
                {e.error ? <p className="mt-1 text-xs text-red-600">{e.error}</p> : null}
              </td>
              <td className="p-3 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
              <td className="p-3 whitespace-nowrap">{e.expiresAt ? formatDateTime(e.expiresAt) : ""}</td>
              <td className="p-3">
                {e.downloadable ? (
                  <a className="text-blue-700 underline" href={exportDownloadUrl(e.id)} download>
                    Tải {e.fileName}
                  </a>
                ) : e.status === "DONE" ? (
                  <span className="text-neutral-500">Đã hết hạn</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
