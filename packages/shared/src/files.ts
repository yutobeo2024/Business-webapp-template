/**
 * Loại tệp được hỗ trợ (kiểm theo NỘI DUNG tệp, không tin đuôi tên hay Content-Type trình duyệt gửi lên).
 * Module chọn tập con cho phép, ví dụ đính kèm phiếu: PR_ATTACHMENT_TYPES.
 */
export const FILE_TYPES = {
  pdf: { mime: "application/pdf", label: "PDF" },
  jpg: { mime: "image/jpeg", label: "Ảnh JPG" },
  png: { mime: "image/png", label: "Ảnh PNG" },
  webp: { mime: "image/webp", label: "Ảnh WEBP" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
} as const;
export type FileTypeKey = keyof typeof FILE_TYPES;

export interface FileDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

/** "PDF, Excel, Word": để viết thông báo lỗi và gợi ý ở ô chọn tệp. */
export const fileTypeLabels = (types: readonly FileTypeKey[]): string =>
  types.map((t) => FILE_TYPES[t].label).join(", ");

/** Giá trị `accept` cho ô chọn tệp (chỉ là gợi ý cho trình duyệt; kiểm thật ở server). */
export const fileAccept = (types: readonly FileTypeKey[]): string =>
  types.map((t) => `.${t === "jpg" ? "jpg,.jpeg" : t}`).join(",");
