/**
 * Lưu trữ tệp. Mọi module đi qua interface FileStorage; hiện có driver đĩa cục bộ (ADR-0005). Thêm S3: viết class mới
 * implement FileStorage và chọn trong createStorage, không phải sửa module.
 */
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface FileStorage {
  put(key: string, data: Readable | Buffer): Promise<void>;
  open(key: string): Promise<Readable>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Khóa do hệ thống sinh: yyyy/mm/<uuid>. Không bao giờ chứa tên gốc người dùng đặt. */
const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export function newStorageKey(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}/${month}/${randomUUID()}`;
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error(`STORAGE_DIR phải là đường dẫn tuyệt đối: ${root}`);
    this.root = resolve(root);
  }

  /** Đường dẫn trên đĩa của một khóa; khóa sai định dạng (../, đường dẫn tuyệt đối...) bị từ chối. */
  private path(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error(`Khóa lưu trữ không hợp lệ: ${key}`);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error(`Khóa lưu trữ ra ngoài thư mục: ${key}`);
    return full;
  }

  async put(key: string, data: Readable | Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    // wx: không ghi đè tệp đã có (khóa trùng là lỗi, không phải thay nội dung tệp của người khác).
    const handle = await open(full, "wx", 0o640);
    try {
      await pipeline(Buffer.isBuffer(data) ? Readable.from([data]) : data, handle.createWriteStream());
    } catch (err) {
      await handle.close().catch(() => undefined);
      await rm(full, { force: true });
      throw err;
    }
  }

  async open(key: string): Promise<Readable> {
    const full = this.path(key);
    await stat(full); // lỗi ENOENT rõ ràng trước khi stream
    return createReadStream(full);
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

export interface StorageEnv {
  STORAGE_DRIVER: "local";
  /** Tuyệt đối, hoặc tương đối so với baseDir (gốc repo khi chạy dev). */
  STORAGE_DIR: string;
}

export function createStorage(env: StorageEnv, baseDir: string): FileStorage {
  switch (env.STORAGE_DRIVER) {
    case "local":
      return new LocalFileStorage(
        isAbsolute(env.STORAGE_DIR) ? env.STORAGE_DIR : join(baseDir, env.STORAGE_DIR),
      );
  }
}
