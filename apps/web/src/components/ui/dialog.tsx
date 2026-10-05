import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Field } from "./field";

/**
 * Hộp thoại dùng thẻ <dialog> gốc: khóa nền, Esc để đóng, focus nằm trong hộp thoại, không cần thư viện.
 * Thay cho window.confirm/prompt (không tùy biến được, không test ổn định, chặn cả trang).
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className="m-auto w-full max-w-lg rounded-lg p-0 shadow-xl backdrop:bg-black/40"
    >
      {open ? (
        <div className="space-y-4 p-6">
          <h2 id="dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Xác nhận thao tác không hoàn tác được (rule frontend: nêu rõ hậu quả). `reason`: bắt nhập lý do, kiểm bằng
 * `reason.validate` (thường gọi schema Zod ở shared) để người dùng thấy đúng câu lỗi trước khi gửi.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // Nội dung chỉ mount khi mở: lý do đã gõ và lỗi tự xóa mỗi lần mở lại.
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onClose}>
      <ConfirmBody {...props} />
    </Dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  reason?: { label: string; validate: (text: string) => string | null };
  pending?: boolean;
  onConfirm: (reason: string | undefined) => void;
  onClose: () => void;
}

function ConfirmBody({
  message,
  confirmLabel = "Xác nhận",
  destructive = false,
  reason,
  pending = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (reason) {
      const err = reason.validate(text);
      if (err) return setError(err);
    }
    onConfirm(reason ? text : undefined);
  };
  return (
    <>
      <p className="text-sm text-neutral-700">{message}</p>
      {reason ? (
        <Field label={reason.label} error={error ?? undefined}>
          <textarea
            className="min-h-20 w-full rounded-md border border-neutral-300 p-2 text-sm aria-[invalid=true]:border-red-500"
            value={text}
            aria-invalid={Boolean(error)}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Hủy bỏ
        </Button>
        <Button variant={destructive ? "destructive" : "default"} onClick={submit} disabled={pending}>
          {pending ? "Đang xử lý..." : confirmLabel}
        </Button>
      </div>
    </>
  );
}
