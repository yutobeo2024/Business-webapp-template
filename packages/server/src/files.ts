/**
 * Tệp đính kèm: kiểm loại theo nội dung, lưu vào storage, ghi hàng `files`. Spec 002, rule backend (storeFile trong
 * withStoredFile, tải về qua sendFile).
 */
import { createHash } from "node:crypto";
import { and, eq, isNotNull, lte, notInArray, or, type SQL } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { files, type DbOrTx } from "@app/db";
import { FILE_TYPES, type FileDto, type FileTypeKey, fileTypeLabels } from "@app/shared";
import { type FileStorage, newStorageKey } from "./storage.js";

/**
 * Thời gian GIỮ tệp vật lý sau khi xóa mềm, theo entity_type (spec 002). Mặc định 7 ngày (khôi phục khi xóa nhầm).
 * Chứng từ phải lưu theo luật (kế toán: 10 năm) khai báo "forever": job dọn dẹp không bao giờ xóa vật lý.
 * Tệp xuất (export_job) và tệp nhập (import_job) có vòng đời riêng, không theo bảng này.
 */
export const FILE_RETENTION: Record<string, number | "forever"> = {
  purchase_request: 7, // sample: đính kèm phiếu mẫu
};
export const DEFAULT_FILE_RETENTION_DAYS = 7;

/**
 * Điều kiện SQL chọn tệp đã xóa mềm ĐƯỢC xóa vật lý lúc `now` theo FILE_RETENTION (loại "forever" không bao giờ khớp).
 * Lọc ngay trong truy vấn, không lấy N dòng rồi mới lọc: nhiều tệp giữ lâu không được chặn mất việc dọn loại khác.
 * `excluded`: loại có vòng đời riêng (tệp xuất, tệp nhập).
 */
export function purgeableDeletedFilesWhere(now: Date, excluded: readonly string[]): SQL {
  const before = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const configured = Object.keys(FILE_RETENTION);
  const perType = Object.entries(FILE_RETENTION)
    .filter((e): e is [string, number] => e[1] !== "forever" && !excluded.includes(e[0]))
    .map(([type, days]) => and(eq(files.entityType, type), lte(files.deletedAt, before(days))));
  const others = and(
    notInArray(files.entityType, [...configured, ...excluded]),
    lte(files.deletedAt, before(DEFAULT_FILE_RETENTION_DAYS)),
  );
  return and(isNotNull(files.deletedAt), or(others, ...perType))!;
}

/** Tệp đã xóa mềm lúc `deletedAt` của loại `entityType` có được xóa vật lý vào lúc `now` không. */
export function canPurgeDeletedFile(entityType: string, deletedAt: Date, now = new Date()): boolean {
  const keep = FILE_RETENTION[entityType] ?? DEFAULT_FILE_RETENTION_DAYS;
  if (keep === "forever") return false;
  return deletedAt.getTime() <= now.getTime() - keep * 24 * 60 * 60 * 1000;
}

export class FileRejectedError extends Error {
  constructor(
    public readonly code: "FILE_TYPE_NOT_ALLOWED" | "FILE_TOO_LARGE" | "FILE_EMPTY",
    message: string,
  ) {
    super(message);
  }
}

/** Loại tệp theo nội dung (magic bytes). Không khớp danh sách cho phép: ném FileRejectedError. */
export async function detectAllowedType(
  buffer: Buffer,
  allowed: readonly FileTypeKey[],
): Promise<FileTypeKey> {
  if (buffer.length === 0) throw new FileRejectedError("FILE_EMPTY", "Tệp rỗng");
  const detected = await fileTypeFromBuffer(buffer);
  const key = detected?.ext === "jpeg" ? "jpg" : detected?.ext;
  if (!key || !(allowed as readonly string[]).includes(key)) {
    throw new FileRejectedError(
      "FILE_TYPE_NOT_ALLOWED",
      `Loại tệp không được phép. Chỉ nhận: ${fileTypeLabels(allowed)} (kiểm theo nội dung tệp, không theo đuôi tên).`,
    );
  }
  return key as FileTypeKey;
}

/** Tên hiển thị an toàn: bỏ đường dẫn, ký tự điều khiển, giới hạn độ dài. Chỉ để hiển thị/tải về, không dùng làm đường dẫn. */
/**
 * Ký tự bị bỏ khỏi tên tệp: điều khiển (C0, DEL, C1), đổi hướng chữ (U+202E làm "hoadon<U+202E>fdp.exe" hiển thị như
 * "hoadonexe.pdf") và ký tự không hợp lệ trong tên tệp trên Windows.
 */
function isUnsafeNameChar(c: string): boolean {
  const code = c.codePointAt(0)!;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    '"<>|*?:'.includes(c)
  );
}

export function safeDisplayName(name: string, ext: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const base = [...last]
    .filter((c) => !isUnsafeNameChar(c))
    .join("")
    .trim()
    .slice(0, 150);
  const withoutExt = base.replace(/\.[^.]*$/, "") || "tep";
  return `${withoutExt}.${ext}`;
}

/**
 * Header Content-Disposition luôn là `attachment` (không hiển thị trong trình duyệt: tệp HTML/SVG giả dạng không chạy được
 * trên tên miền của app), có tên tiếng Việt theo RFC 5987 và tên ASCII dự phòng.
 */
export function contentDisposition(name: string): string {
  const ascii = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  // encodeURIComponent để nguyên ' ( ) * ! nhưng RFC 5987 không cho phép trong filename*.
  const encoded = encodeURIComponent(name).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface SaveFileInput {
  buffer: Buffer;
  originalName: string;
  allowed: readonly FileTypeKey[];
  maxBytes: number;
  uploadedBy: string;
  entityType: string;
  entityId: string;
}

/**
 * Ghi tệp vào storage rồi thêm hàng `files` bằng `tx` của module (cùng transaction với audit). Nơi gọi PHẢI xóa tệp vật lý
 * nếu transaction thất bại: dùng `withStoredFile` để khỏi quên.
 */
export async function storeFile(
  tx: DbOrTx,
  storage: FileStorage,
  input: SaveFileInput,
): Promise<{ row: typeof files.$inferSelect; dto: FileDto }> {
  if (input.buffer.length > input.maxBytes) {
    throw new FileRejectedError("FILE_TOO_LARGE", `Tệp vượt ${Math.floor(input.maxBytes / 1024 / 1024)} MB`);
  }
  const type = await detectAllowedType(input.buffer, input.allowed);
  const storageKey = newStorageKey();
  await storage.put(storageKey, input.buffer);
  const [row] = await tx
    .insert(files)
    .values({
      storageKey,
      originalName: safeDisplayName(input.originalName, type),
      mimeType: FILE_TYPES[type].mime,
      sizeBytes: input.buffer.length,
      sha256: createHash("sha256").update(input.buffer).digest("hex"),
      entityType: input.entityType,
      entityId: input.entityId,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  return { row: row!, dto: toFileDto(row!) };
}

/**
 * Chạy `work` (thường là một transaction gọi storeFile); lỗi thì xóa mọi tệp vật lý đã ghi trong lúc đó,
 * để transaction bị rollback không để lại tệp mồ côi trên đĩa.
 */
export async function withStoredFile<T>(
  storage: FileStorage,
  work: (track: FileStorage) => Promise<T>,
): Promise<T> {
  const written: string[] = [];
  const tracking: FileStorage = {
    put: async (key, data) => {
      await storage.put(key, data);
      written.push(key);
    },
    open: (key) => storage.open(key),
    remove: (key) => storage.remove(key),
    exists: (key) => storage.exists(key),
  };
  try {
    return await work(tracking);
  } catch (err) {
    await Promise.all(written.map((k) => storage.remove(k).catch(() => undefined)));
    throw err;
  }
}

export function toFileDto(row: typeof files.$inferSelect): FileDto {
  return {
    id: row.id,
    name: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}
