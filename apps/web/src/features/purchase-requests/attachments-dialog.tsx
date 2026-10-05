import { useRef, useState } from "react";
import {
  fileAccept,
  fileTypeLabels,
  formatBytes,
  formatDateTime,
  PR_ATTACHMENT_LIMIT,
  PR_ATTACHMENT_TYPES,
  type PurchaseRequestDto,
} from "@app/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { apiErrorMessage } from "@/lib/api";
import { attachmentDownloadUrl, useAttachments, useRemoveAttachment, useUploadAttachment } from "./api";

/** BR-09: xem/tải đính kèm (ai xem được phiếu); thêm/xóa khi `canManageAttachments`. Mẫu dùng lõi tệp (spec 002). */
export function AttachmentsButton({ pr }: { pr: PurchaseRequestDto }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Đính kèm
      </Button>
      <Dialog open={open} title={`Tệp đính kèm: ${pr.code}`} onClose={() => setOpen(false)}>
        <AttachmentsBody pr={pr} onClose={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function AttachmentsBody({ pr, onClose }: { pr: PurchaseRequestDto; onClose: () => void }) {
  const list = useAttachments(pr.id, true);
  const upload = useUploadAttachment(pr.id);
  const remove = useRemoveAttachment(pr.id);
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const files = list.data ?? [];
  const error = apiErrorMessage(upload.error) ?? apiErrorMessage(remove.error) ?? apiErrorMessage(list.error);

  return (
    <div className="space-y-4">
      {list.isPending ? <p className="text-sm text-neutral-500">Đang tải...</p> : null}
      {!list.isPending && files.length === 0 ? (
        <p className="text-sm text-neutral-500">Chưa có tệp đính kèm.</p>
      ) : null}
      <ul className="divide-y rounded border">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 p-2 text-sm">
            <div className="min-w-0">
              <a
                className="block truncate text-blue-700 underline"
                href={attachmentDownloadUrl(pr.id, f.id)}
                download
              >
                {f.name}
              </a>
              <span className="text-xs text-neutral-500">
                {formatBytes(f.sizeBytes)} · {formatDateTime(f.createdAt)}
              </span>
            </div>
            {pr.canManageAttachments ? (
              <Button size="sm" variant="outline" onClick={() => setRemoving({ id: f.id, name: f.name })}>
                Xóa
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {pr.canManageAttachments ? (
        <div className="space-y-1">
          <input
            ref={input}
            type="file"
            className="sr-only"
            aria-label="Chọn tệp đính kèm"
            accept={fileAccept(PR_ATTACHMENT_TYPES)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // chọn lại cùng tệp vẫn kích hoạt onChange
              if (file) upload.mutate(file);
            }}
          />
          <Button
            size="sm"
            disabled={upload.isPending || files.length >= PR_ATTACHMENT_LIMIT}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? "Đang tải lên..." : "Thêm tệp"}
          </Button>
          <p className="text-xs text-neutral-500">
            {fileTypeLabels(PR_ATTACHMENT_TYPES)}; tối đa {PR_ATTACHMENT_LIMIT} tệp.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Đóng
        </Button>
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Xóa tệp đính kèm"
        message={`Xóa tệp "${removing?.name ?? ""}" khỏi phiếu ${pr.code}?`}
        confirmLabel="Xóa"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
