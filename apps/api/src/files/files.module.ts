import { Global, Inject, Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { Readable } from "node:stream";
import type { Response } from "express";
import type { files } from "@app/db";
import { contentDisposition, createStorage, FileRejectedError, type FileStorage } from "@app/server";
import { BusinessError } from "../common/business-error.js";
import { ENV, type Env } from "../config/env.js";

export const STORAGE = Symbol("STORAGE");

/** Gốc repo (STORAGE_DIR tương đối khi chạy dev): apps/api/{src,dist}/files -> ../../../../ */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

@Global()
@Module({
  imports: [
    // Cấu hình chung cho mọi FileInterceptor: giữ tệp trong bộ nhớ (để kiểm nội dung trước khi lưu), giới hạn dung lượng
    // và số tệp ngay khi nhận (vượt: 413, không đọc hết body vào RAM).
    MulterModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        storage: memoryStorage(),
        // Tên tệp tiếng Việt: trình duyệt gửi UTF-8 không kèm charset; mặc định multer đọc latin1 làm hỏng dấu.
        defParamCharset: "utf8",
        limits: { fileSize: env.FILE_MAX_MB * 1024 * 1024, files: 1, fields: 5, parts: 10 },
      }),
    }),
  ],
  providers: [{ provide: STORAGE, inject: [ENV], useFactory: (env: Env) => createStorage(env, REPO_ROOT) }],
  exports: [STORAGE, MulterModule],
})
export class FilesModule {
  constructor(@Inject(STORAGE) readonly storage: FileStorage) {}
}

/**
 * Gửi tệp về trình duyệt: luôn tải về (attachment), không cho trình duyệt đoán loại (nosniff), không cache dùng chung.
 * Mọi endpoint tải tệp dùng hàm này, sau khi module đã kiểm quyền xem bản ghi chứa tệp.
 */
export async function sendFile(
  storage: FileStorage,
  res: Response,
  file: typeof files.$inferSelect,
): Promise<void> {
  let stream: Readable;
  try {
    stream = await storage.open(file.storageKey);
  } catch (err) {
    // Hàng còn mà tệp vật lý mất (khôi phục DB và tệp lệch thời điểm, hoặc đang dọn dẹp): báo đúng tệp đó.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BusinessError("FILE_GONE", "Tệp không còn trên máy chủ. Vui lòng báo quản trị viên.", 410);
    }
    throw err;
  }
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", String(file.sizeBytes));
  res.setHeader("Content-Disposition", contentDisposition(file.originalName));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  // pipeline hủy luồng đọc khi client ngắt giữa chừng (pipe() thì giữ file descriptor và bộ đệm mãi).
  await pipeline(stream, res).catch((err: unknown) => {
    if ((err as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE") return; // người dùng hủy tải
    throw err;
  });
}

/** Lỗi kiểm tệp (loại, dung lượng) thành lỗi HTTP có câu tiếng Việt. */
export function toHttpFileError(err: unknown): unknown {
  if (!(err instanceof FileRejectedError)) return err;
  if (err.code === "FILE_TOO_LARGE") return new BusinessError(err.code, err.message, 413);
  if (err.code === "FILE_TYPE_NOT_ALLOWED") return new BusinessError(err.code, err.message, 415);
  return new BusinessError(err.code, err.message, 400);
}
