/**
 * Tích hợp lõi xuất file (spec 002): PostgreSQL + Chromium THẬT, loại xuất lõi "danh sách người dùng". Kiểm quyền tại
 * lúc chạy, giới hạn dòng, chạy lại an toàn, dọn dẹp theo chính sách lưu tệp, PDF bằng mẫu tối thiểu. Không phụ thuộc
 * module mẫu (test xuất của mẫu: src/sample/exports.int.spec.ts).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, exportJobs, files, rolePermissions, users, type DbHandle } from "@app/db";
import { FILE_RETENTION, LocalFileStorage, storeFile } from "@app/server";
import type { CreateExportInput } from "@app/shared";
import { makeUser, resetWorkerDb } from "../testing/fixture.js";
import { PdfRenderer } from "./pdf.js";
import { cleanupFiles, type ExportDeps, markStuckExports, runExport } from "./processor.js";
import { pdfCheckHtml } from "./templates/pdf-check.js";

let handle: DbHandle;
let deps: ExportDeps;
let deptKd: string;
const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), "worker-exports-")));
const pdf = new PdfRenderer(process.env.CHROMIUM_PATH);
const USERS: CreateExportInput = { type: "admin.users.xlsx", params: { sort: "fullName", order: "asc" } };

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
  deps = { db: handle.db, log: pino({ level: "silent" }), storage, pdf, ttlHours: 24, maxRows: 100 };
});
afterAll(async () => {
  await pdf.close();
  await handle.close();
});
beforeEach(async () => {
  ({ deptKd } = await resetWorkerDb(handle.db));
});

async function requestExport(requestedBy: string, input: CreateExportInput) {
  const [row] = await handle.db
    .insert(exportJobs)
    .values({ type: input.type, params: input.params, requestedBy })
    .returning();
  return row!.id;
}

async function readXlsx(exportId: string) {
  const [job] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, exportId));
  const [file] = await handle.db.select().from(files).where(eq(files.id, job!.fileId!));
  const chunks: Buffer[] = [];
  for await (const c of await storage.open(file!.storageKey)) chunks.push(c as Buffer);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.concat(chunks) as unknown as ArrayBuffer);
  return { job: job!, file: file!, sheet: wb.worksheets[0]! };
}

describe("xuất Excel danh sách người dùng", () => {
  it("đúng bộ lọc và thứ tự của màn quản trị; cột tiếng Việt; tên tệp theo giờ Việt Nam", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    await makeUser(handle.db, "an", deptKd, []);
    const locked = await makeUser(handle.db, "binh", deptKd, []);
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, locked.id));

    const id = await requestExport(admin.id, {
      type: "admin.users.xlsx",
      params: { status: "active", sort: "fullName", order: "asc" },
    });
    expect(await runExport(deps, id)).toBe("done");
    const { job, file, sheet } = await readXlsx(id);
    expect(job.rowCount).toBe(2);
    expect(file.originalName).toMatch(/^nguoi-dung-\d{8}-\d{4}\.xlsx$/);
    expect(sheet.getRow(1).getCell(1).value).toBe("Họ tên");
    // Không xuất số điện thoại: dữ liệu cá nhân chỉ dùng cho Zalo, màn danh sách cũng không hiện.
    const headers: string[] = [];
    sheet.getRow(1).eachCell((c) => headers.push(String(c.value)));
    expect(headers).toEqual(["Họ tên", "Email", "Phòng ban", "Vai trò", "Trạng thái", "Ngày tạo"]);
    const names: string[] = [];
    sheet.eachRow((row, i) => {
      if (i > 1) names.push(String(row.getCell(1).value));
    });
    expect(names).toEqual(["an", "quan-tri"]);
  });

  it("người yêu cầu bị thu quyền hoặc bị khóa sau khi bấm: FAILED, không có tệp", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    const revoked = await requestExport(admin.id, USERS);
    await handle.db.delete(rolePermissions).where(eq(rolePermissions.roleId, admin.roleId));
    expect(await runExport(deps, revoked)).toBe("failed");

    await handle.db.insert(rolePermissions).values({ roleId: admin.roleId, permission: "users.manage" });
    const locked = await requestExport(admin.id, USERS);
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, admin.id));
    expect(await runExport(deps, locked)).toBe("failed");

    const rows = await handle.db.select().from(exportJobs);
    expect(rows.map((r) => r.error).sort()).toEqual(
      ["Bạn không còn quyền xuất dữ liệu này.", "Tài khoản yêu cầu xuất đã bị khóa."].sort(),
    );
    expect(await handle.db.select().from(files)).toHaveLength(0);
  });

  it("vượt EXPORT_MAX_ROWS: FAILED với hướng dẫn lọc bớt", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    for (const n of ["a", "b"]) await makeUser(handle.db, n, deptKd, []);
    const id = await requestExport(admin.id, USERS);
    expect(await runExport({ ...deps, maxRows: 2 }, id)).toBe("failed");
    const [row] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, id));
    expect(row!.error).toMatch(/vượt giới hạn 2 dòng.*lọc bớt/);
  });

  it("chạy lại yêu cầu đã DONE hoặc đã bị API đánh dấu lỗi: bỏ qua, không tạo tệp", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    const done = await requestExport(admin.id, USERS);
    expect(await runExport(deps, done)).toBe("done");
    expect(await runExport(deps, done)).toBe("skipped");
    const failed = await requestExport(admin.id, USERS);
    await handle.db.update(exportJobs).set({ status: "FAILED", error: "x" }).where(eq(exportJobs.id, failed));
    expect(await runExport(deps, failed)).toBe("skipped");
    expect(await handle.db.select().from(files)).toHaveLength(1);
  });
});

describe("in PDF (lõi)", () => {
  it("Chromium in mẫu tối thiểu ra PDF A4, chữ có dấu, giá trị chèn vào được escape", async () => {
    const doc = pdfCheckHtml(new Date(), "Ghi chú <script>alert(1)</script>");
    expect(doc.value).not.toContain("<script>");
    const bytes = await pdf.render(doc);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(3_000);
  });
});

describe("dọn dẹp", () => {
  it("xóa tệp xuất hết hạn; tệp đã xóa mềm theo chính sách lưu (chứng từ forever không xóa); đánh dấu yêu cầu kẹt", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    const expired = await requestExport(admin.id, USERS);
    const fresh = await requestExport(admin.id, USERS);
    await runExport(deps, expired);
    await runExport(deps, fresh);
    await handle.db
      .update(exportJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(exportJobs.id, expired));
    const expiredKey = (await readXlsx(expired)).file.storageKey;
    const freshKey = (await readXlsx(fresh)).file.storageKey;

    // Hai tệp đã xóa mềm 10 ngày: một loại mặc định (7 ngày), một loại chứng từ giữ mãi.
    FILE_RETENTION.chung_tu_test = "forever";
    const deleted = async (entityType: string) => {
      const { row } = await storeFile(handle.db, storage, {
        buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
        originalName: "a.pdf",
        allowed: ["pdf"],
        maxBytes: 1024 * 1024,
        uploadedBy: admin.id,
        entityType,
        entityId: "x",
      });
      await handle.db
        .update(files)
        .set({ deletedAt: new Date(Date.now() - 10 * 86_400_000) })
        .where(eq(files.id, row.id));
      return row.storageKey;
    };
    const normalKey = await deleted("dinh_kem_test");
    const voucherKey = await deleted("chung_tu_test");

    const stuck = await requestExport(admin.id, USERS);
    await handle.db
      .update(exportJobs)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(exportJobs.id, stuck));

    try {
      expect(await cleanupFiles(deps)).toEqual({ removed: 2 });
    } finally {
      delete FILE_RETENTION.chung_tu_test;
    }
    expect(await markStuckExports(deps)).toBe(1);
    expect(await storage.exists(expiredKey)).toBe(false);
    expect(await storage.exists(freshKey)).toBe(true);
    expect(await storage.exists(normalKey)).toBe(false);
    expect(await storage.exists(voucherKey)).toBe(true);
    const [s] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, stuck));
    expect(s!.status).toBe("FAILED");
  });

  it("hơn 5000 tệp giữ mãi (chứng từ) không chặn việc dọn tệp loại khác", async () => {
    const admin = await makeUser(handle.db, "quan-tri", null, ["users.manage"]);
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    FILE_RETENTION.chung_tu_test = "forever";
    try {
      await handle.db.insert(files).values(
        Array.from({ length: 5001 }, (_, i) => ({
          storageKey: `chung-tu/${i}`,
          originalName: `${i}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: "x",
          entityType: "chung_tu_test",
          entityId: String(i),
          uploadedBy: admin.id,
          deletedAt: new Date(tenDaysAgo.getTime() - 1000), // xóa TRƯỚC tệp thường: đứng đầu nếu sắp theo deleted_at
        })),
      );
      const { row } = await storeFile(handle.db, storage, {
        buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
        originalName: "a.pdf",
        allowed: ["pdf"],
        maxBytes: 1024 * 1024,
        uploadedBy: admin.id,
        entityType: "dinh_kem_test",
        entityId: "x",
      });
      await handle.db.update(files).set({ deletedAt: tenDaysAgo }).where(eq(files.id, row.id));
      expect(await cleanupFiles(deps)).toEqual({ removed: 1 });
      expect(await storage.exists(row.storageKey)).toBe(false);
    } finally {
      delete FILE_RETENTION.chung_tu_test;
    }
  });
});
