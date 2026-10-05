/**
 * Nội dung từng loại thông báo. Mỗi loại PHẢI có đủ mẫu (typecheck đỏ nếu thiếu): dòng tiêu đề + nội dung ngắn cho
 * thông báo trong app, đường dẫn trang đích. Không đưa vào nội dung thứ người nhận không được xem.
 */
import { type NotificationData, type NotificationType } from "@app/shared";
import { formatVnd } from "@app/shared"; // sample

export interface RenderedNotification {
  title: string;
  body: string;
  /** Đường dẫn trong app, bắt đầu bằng "/". */
  link: string | null;
}

type Template<T extends NotificationType> = (data: NotificationData<T>) => RenderedNotification;

const prLink = (code: string) => `/purchase-requests?q=${encodeURIComponent(code)}`; // sample

const IMPORT_RESULT: Record<
  NotificationData<"import.finished">["status"],
  (d: NotificationData<"import.finished">) => string
> = {
  READY: (d) => `Tệp nhập ${d.label.toLowerCase()} đã kiểm xong, không có lỗi. Vào xác nhận để ghi dữ liệu.`,
  DONE: (d) => `Đã nhập ${d.importedCount ?? 0} dòng ${d.label.toLowerCase()}.`,
  INVALID: (d) =>
    `Tệp nhập ${d.label.toLowerCase()} có ${d.errorCount} lỗi, chưa nhập dòng nào. Sửa tệp rồi tải lại.`,
  FAILED: (d) =>
    `Nhập ${d.label.toLowerCase()} gặp lỗi hệ thống, chưa nhập dòng nào. Thử lại hoặc báo quản trị viên.`,
};

export const NOTIFICATION_TEMPLATES: { [T in NotificationType]: Template<T> } = {
  "account.password_reset": (d) => ({
    title: "Mật khẩu của bạn đã được đặt lại",
    body: `${d.resetByName} (quản trị viên) đã đặt lại mật khẩu tài khoản của bạn; mọi phiên đăng nhập cũ đã bị thoát. Nếu bạn không yêu cầu việc này, báo ngay cho quản trị viên.`,
    link: null,
  }),
  "import.finished": (d) => ({
    title:
      d.status === "DONE"
        ? `Nhập ${d.label.toLowerCase()} xong`
        : `Kết quả kiểm tệp nhập ${d.label.toLowerCase()}`,
    body: IMPORT_RESULT[d.status](d),
    link: d.returnPath,
  }),
  // sample:begin
  "pr.pending_approval": (d) => ({
    title: `Phiếu ${d.code} chờ bạn duyệt`,
    body: `${d.requesterName} đề nghị: ${d.title} (${formatVnd(d.totalAmount)}).`,
    link: prLink(d.code),
  }),
  "pr.approved": (d) => ({
    title: `Phiếu ${d.code} đã được duyệt`,
    body: `${d.title} (${formatVnd(d.totalAmount)}) đã được duyệt.`,
    link: prLink(d.code),
  }),
  "pr.rejected": (d) => ({
    title: `Phiếu ${d.code} bị từ chối`,
    body: `${d.title}. Lý do: ${d.reason}`,
    link: prLink(d.code),
  }),
  // sample:end
};

export function renderNotification<T extends NotificationType>(
  type: T,
  data: NotificationData<T>,
): RenderedNotification {
  return NOTIFICATION_TEMPLATES[type](data);
}
