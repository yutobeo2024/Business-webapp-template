import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canPurgeDeletedFile,
  contentDisposition,
  detectAllowedType,
  FILE_RETENTION,
  FileRejectedError,
  safeDisplayName,
} from "./files.js";
import { LocalFileStorage, newStorageKey } from "./storage.js";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("LocalFileStorage", () => {
  const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), "storage-spec-")));

  it("ghi, đọc, xóa theo khóa hệ thống sinh", async () => {
    const key = newStorageKey();
    await storage.put(key, Buffer.from("noi dung"));
    expect(await storage.exists(key)).toBe(true);
    const chunks: Buffer[] = [];
    for await (const c of await storage.open(key)) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("noi dung");
    await storage.remove(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("khóa lạ bị từ chối: thoát thư mục, đường dẫn tuyệt đối, tên người dùng đặt", async () => {
    for (const key of [
      "../../etc/passwd",
      "/etc/passwd",
      "2026/10/../../x",
      "bao-gia.pdf",
      "C:\\Windows\\x",
    ]) {
      await expect(storage.put(key, Buffer.from("x")), key).rejects.toThrow(/Khóa lưu trữ/);
      await expect(storage.open(key), key).rejects.toThrow(/Khóa lưu trữ/);
    }
  });

  it("không ghi đè tệp đã có", async () => {
    const key = newStorageKey();
    await storage.put(key, Buffer.from("a"));
    await expect(storage.put(key, Buffer.from("b"))).rejects.toThrow();
  });

  it("thư mục gốc phải là đường dẫn tuyệt đối", () => {
    expect(() => new LocalFileStorage(".data/files")).toThrow(/tuyệt đối/);
  });
});

describe("detectAllowedType", () => {
  it("nhận theo nội dung", async () => {
    expect(await detectAllowedType(PDF, ["pdf"])).toBe("pdf");
    expect(await detectAllowedType(PNG, ["pdf", "png"])).toBe("png");
  });
  it("tệp chạy được đổi đuôi .pdf vẫn bị từ chối; loại không có trong danh sách bị từ chối", async () => {
    await expect(detectAllowedType(EXE, ["pdf"])).rejects.toBeInstanceOf(FileRejectedError);
    await expect(detectAllowedType(PNG, ["pdf"])).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
    await expect(detectAllowedType(Buffer.from("<html><script>"), ["pdf"])).rejects.toMatchObject({
      code: "FILE_TYPE_NOT_ALLOWED",
    });
    await expect(detectAllowedType(Buffer.alloc(0), ["pdf"])).rejects.toMatchObject({ code: "FILE_EMPTY" });
  });
});

describe("tên tệp", () => {
  it("bỏ đường dẫn, ký tự điều khiển; đuôi theo loại thật", () => {
    expect(safeDisplayName("..\\..\\Báo giá\u0000 Q4.exe", "pdf")).toBe("Báo giá Q4.pdf");
    expect(safeDisplayName("", "png")).toBe("tep.png");
    // Ký tự đổi hướng chữ làm "hoadon\u202Efdp.jpg" hiển thị như "hoadongpj.pdf".
    expect(safeDisplayName("hoadon\u202Efdp\u0085.jpg", "pdf")).toBe("hoadonfdp.pdf");
  });
  it("Content-Disposition luôn attachment, có tên tiếng Việt chuẩn RFC 5987 và tên ASCII dự phòng", () => {
    const h = contentDisposition('Báo giá "đợt 1".pdf');
    expect(h).toMatch(/^attachment; /);
    expect(h).toContain('filename="Bao gia _dot 1_.pdf"');
    expect(h).toContain("filename*=UTF-8''B%C3%A1o%20gi%C3%A1%20%22%C4%91%E1%BB%A3t%201%22.pdf");
    expect(contentDisposition("Bảng (bản 2) 'cuối'.pdf")).toContain(
      "filename*=UTF-8''B%E1%BA%A3ng%20%28b%E1%BA%A3n%202%29%20%27cu%E1%BB%91i%27.pdf",
    );
  });
});

describe("chính sách lưu tệp đã xóa mềm", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  it("mặc định giữ 7 ngày; loại khai báo forever (chứng từ) không bao giờ xóa vật lý", () => {
    expect(canPurgeDeletedFile("loai_chua_khai_bao", daysAgo(6), now)).toBe(false);
    expect(canPurgeDeletedFile("loai_chua_khai_bao", daysAgo(7), now)).toBe(true);
    FILE_RETENTION.chung_tu_test = "forever";
    FILE_RETENTION.giu_30_ngay_test = 30;
    expect(canPurgeDeletedFile("chung_tu_test", daysAgo(4000), now)).toBe(false);
    expect(canPurgeDeletedFile("giu_30_ngay_test", daysAgo(29), now)).toBe(false);
    expect(canPurgeDeletedFile("giu_30_ngay_test", daysAgo(30), now)).toBe(true);
    delete FILE_RETENTION.chung_tu_test;
    delete FILE_RETENTION.giu_30_ngay_test;
  });
});
