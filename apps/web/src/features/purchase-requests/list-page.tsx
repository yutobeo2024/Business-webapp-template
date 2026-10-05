import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import {
  can,
  formatDateTime,
  formatVnd,
  type ListPurchaseRequestsQuery,
  PR_EVENT_LABELS,
  PR_STATUS_LABELS,
  PR_STATUSES,
  type PrEvent,
  type PrStatus,
  type PurchaseRequestDto,
  transitionPurchaseRequestSchema,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, SortTh, Th } from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Badge, SearchInput, Select } from "@/components/ui/form-controls";
import { useMe } from "@/features/auth/use-me";
import { ExportButton } from "@/features/exports/export-button";
import { ApiError } from "@/lib/api";
import { nextSearch } from "@/lib/list-search";
import { usePurchaseRequests, useTransition } from "./api";
import { AttachmentsButton } from "./attachments-dialog";
import { CreatePurchaseRequestForm } from "./create-form";

const route = getRouteApi("/purchase-requests");

const STATUS_TONE: Record<PrStatus, Parameters<typeof Badge>[0]["tone"]> = {
  DRAFT: "neutral",
  PENDING_MANAGER: "amber",
  PENDING_DIRECTOR: "orange",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "muted",
};

// Thao tác không hoàn tác được hoặc quan trọng: xác nhận, nêu rõ hậu quả. Từ chối thì bắt nhập lý do.
const CONFIRM: Partial<Record<PrEvent, { message: string; destructive?: boolean }>> = {
  CANCEL: { message: "Phiếu đã hủy không khôi phục được.", destructive: true },
  MANAGER_APPROVE: { message: "Duyệt phiếu này?" },
  DIRECTOR_APPROVE: { message: "Duyệt phiếu này?" },
  REJECT: { message: "Người lập sẽ thấy lý do và có thể sửa lại phiếu.", destructive: true },
};

function Actions({ pr }: { pr: PurchaseRequestDto }) {
  const t = useTransition();
  const [pending, setPending] = useState<PrEvent | null>(null);
  const send = (event: PrEvent, reason?: string) =>
    t.mutate({ id: pr.id, event, version: pr.version, reason }, { onSettled: () => setPending(null) });
  const confirm = pending ? CONFIRM[pending] : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pr.allowedEvents.map((e) => (
        <Button
          key={e}
          size="sm"
          variant={e === "REJECT" || e === "CANCEL" ? "outline" : "default"}
          disabled={t.isPending}
          onClick={() => (CONFIRM[e] ? setPending(e) : send(e))}
        >
          {PR_EVENT_LABELS[e]}
        </Button>
      ))}
      {t.error ? (
        <span role="alert" className="text-sm text-red-600">
          {t.error instanceof ApiError ? t.error.message : "Có lỗi xảy ra"}
        </span>
      ) : null}
      <ConfirmDialog
        open={Boolean(pending)}
        title={`${pending ? PR_EVENT_LABELS[pending] : ""}: ${pr.code}`}
        message={confirm?.message ?? ""}
        confirmLabel={pending ? PR_EVENT_LABELS[pending] : undefined}
        destructive={confirm?.destructive}
        pending={t.isPending}
        // Kiểm bằng schema dùng chung trước khi gửi, để người dùng thấy đúng câu lỗi.
        reason={
          pending === "REJECT"
            ? {
                label: "Lý do từ chối",
                validate: (reason) => {
                  const r = transitionPurchaseRequestSchema.safeParse({
                    event: "REJECT",
                    version: pr.version,
                    reason,
                  });
                  return r.success ? null : (r.error.issues[0]?.message ?? "Lý do không hợp lệ");
                },
              }
            : undefined
        }
        onConfirm={(reason) => pending && send(pending, reason)}
        onClose={() => setPending(null)}
      />
    </div>
  );
}

export function PurchaseRequestListPage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const setSearch = (patch: Partial<ListPurchaseRequestsQuery>) =>
    void navigate({ search: nextSearch(search, patch), replace: true });
  const [showForm, setShowForm] = useState(false);
  const q = usePurchaseRequests(search);
  // Chỉ hiện nút cho người có quyền lập phiếu. Quyền thật do backend kiểm.
  const me = useMe();
  const canCreate = can(me.data, "pr.create");
  const canExport = can(me.data, "pr.export");
  const sortProps = {
    sort: search.sort,
    order: search.order,
    onSort: (sort: typeof search.sort, order: typeof search.order) => setSearch({ sort, order }),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Phiếu đề nghị mua hàng</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canExport ? (
            // Xuất đúng bộ lọc và thứ tự đang xem (không phân trang).
            <ExportButton
              label="Xuất Excel"
              input={{
                type: "purchase-requests.xlsx",
                params: { q: search.q, status: search.status, sort: search.sort, order: search.order },
              }}
            />
          ) : null}
          {canCreate && !showForm ? <Button onClick={() => setShowForm(true)}>Lập phiếu</Button> : null}
        </div>
      </div>
      {showForm ? <CreatePurchaseRequestForm onDone={() => setShowForm(false)} /> : null}
      <div className="flex flex-wrap gap-2">
        <SearchInput
          className="max-w-xs"
          placeholder="Tìm theo mã hoặc tiêu đề"
          aria-label="Tìm kiếm phiếu"
          value={search.q ?? ""}
          onChange={(text) => setSearch({ q: text })}
        />
        <Select
          aria-label="Lọc trạng thái"
          value={search.status ?? ""}
          onChange={(e) => setSearch({ status: (e.target.value || undefined) as PrStatus | undefined })}
        >
          <option value="">Mọi trạng thái</option>
          {PR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PR_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        isPending={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        isEmpty={q.data?.items.length === 0}
        emptyText={search.q || search.status ? "Không có phiếu nào khớp bộ lọc." : "Chưa có phiếu nào."}
      >
        <thead className="border-b bg-neutral-50">
          <tr>
            <SortTh field="code" label="Mã phiếu" {...sortProps} />
            <Th>Tiêu đề</Th>
            <Th>Người lập</Th>
            <SortTh field="totalAmount" label="Tổng tiền" className="text-right" {...sortProps} />
            <SortTh field="status" label="Trạng thái" {...sortProps} />
            <SortTh field="createdAt" label="Ngày lập" {...sortProps} />
            <Th>Thao tác</Th>
          </tr>
        </thead>
        <tbody>
          {q.data?.items.map((pr) => (
            <tr key={pr.id} className="border-b align-top last:border-0">
              <td className="p-3 font-mono">{pr.code}</td>
              <td className="p-3">
                {pr.title}
                {pr.rejectReason ? (
                  <p className="mt-1 text-xs text-red-600">Lý do từ chối: {pr.rejectReason}</p>
                ) : null}
              </td>
              <td className="p-3">{pr.requesterName}</td>
              <td className="p-3 text-right tabular-nums">{formatVnd(pr.totalAmount)}</td>
              <td className="p-3">
                <Badge tone={STATUS_TONE[pr.status]}>{PR_STATUS_LABELS[pr.status]}</Badge>
              </td>
              <td className="p-3 whitespace-nowrap">{formatDateTime(pr.createdAt)}</td>
              <td className="p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Actions pr={pr} />
                  <AttachmentsButton pr={pr} />
                  <ExportButton
                    label="In PDF"
                    input={{ type: "purchase-request.pdf", params: { id: pr.id } }}
                  />
                </div>
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
    </div>
  );
}
