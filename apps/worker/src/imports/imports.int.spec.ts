/**
 * Tích hợp nhập Excel (spec 003), DB thật: kiểm từng dòng, xem trước, ghi tất-cả-hoặc-không, kiểm lại lúc xác nhận.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, createDb, departments, importJobs, rolePermissions, type DbHandle } from "@app/db";
import { LocalFileStorage, storeFile } from "@app/server";
import { makeUser, resetWorkerDb } from "../testing/fixture.js";
import { commitImport, type ImportDeps, sweepImports, validateImport } from "./processor.js";

let handle: DbHandle;
let deps: ImportDeps;
const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), "worker-imports-")));

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
  deps = { db: handle.db, log: pino({ level: "silent" }), storage, maxRows: 100 };
});
afterAll(() => handle.close());
beforeEach(async () => {
  await resetWorkerDb(handle.db); // tạo sẵn phòng ban KD, KT
});

async function xlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Phòng ban");
  ws.addRow(["Mã phòng ban", "Tên phòng ban"]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Như API: lưu tệp + tạo yêu cầu ở trạng thái VALIDATING. */
async function upload(userId: string, rows: string[][]): Promise<string> {
  const id = crypto.randomUUID();
  const { row: file } = await storeFile(handle.db, storage, {
    buffer: await xlsx(rows),
    originalName: "phong-ban.xlsx",
    allowed: ["xlsx"],
    maxBytes: 5 * 1024 * 1024,
    uploadedBy: userId,
    entityType: "import_job",
    entityId: id,
  });
  await handle.db
    .insert(importJobs)
    .values({ id, type: "departments", fileId: file.id, requestedBy: userId });
  return id;
}
const jobOf = async (id: string) =>
  (await handle.db.select().from(importJobs).where(eq(importJobs.id, id)))[0]!;
const confirm = (id: string) =>
  handle.db.update(importJobs).set({ status: "COMMITTING" }).where(eq(importJobs.id, id));
const deptCount = async () => (await handle.db.select().from(departments)).length;

describe("nhập phòng ban từ Excel", () => {
  it("lỗi báo đúng dòng và cột: sai định dạng mã, trống tên, trùng trong tệp, trùng mã đã có; không ghi gì", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const id = await upload(admin.id, [
      ["HC", "Hành chính"],
      ["mã sai!", "Tên"],
      ["DA", ""],
      ["HC", "Trùng trong tệp"],
      ["KD", "Đã có"],
    ]);
    expect(await validateImport(deps, id)).toBe("INVALID");
    const job = await jobOf(id);
    expect(job.totalRows).toBe(5);
    expect(job.errors.map((e) => [e.row, e.column])).toEqual([
      [3, "Mã phòng ban"],
      [4, "Tên phòng ban"],
      [5, "Mã phòng ban"],
      [6, "Mã phòng ban"],
    ]);
    expect(job.errors[2]!.message).toBe("Mã HC trùng với dòng 2");
    expect(job.errors[3]!.message).toBe("Mã KD đã có trong hệ thống");
    expect(await deptCount()).toBe(2);
  });

  it("tệp đúng: READY kèm xem trước; xác nhận thì ghi tất cả, có audit; chạy lại không ghi lần hai", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const id = await upload(admin.id, [
      ["hc", "  Hành chính  "],
      ["DA", "Dự án"],
    ]);
    expect(await validateImport(deps, id)).toBe("READY");
    expect((await jobOf(id)).preview).toEqual([
      { "Mã phòng ban": "HC", "Tên phòng ban": "Hành chính" },
      { "Mã phòng ban": "DA", "Tên phòng ban": "Dự án" },
    ]);
    await confirm(id);
    expect(await commitImport(deps, id)).toBe("DONE");
    expect(await commitImport(deps, id)).toBe("skipped");
    expect(await deptCount()).toBe(4);
    expect((await jobOf(id)).importedCount).toBe(2);
    const [audit] = await handle.db.select().from(auditLogs).where(eq(auditLogs.action, "import.commit"));
    expect(audit).toMatchObject({
      actorId: admin.id,
      entityId: id,
      after: expect.objectContaining({ rows: 2 }),
    });
  });

  it("dữ liệu đổi giữa xem trước và xác nhận (mã vừa được tạo tay): không ghi dòng nào, báo lỗi mới", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const id = await upload(admin.id, [
      ["HC", "Hành chính"],
      ["DA", "Dự án"],
    ]);
    await validateImport(deps, id);
    await handle.db.insert(departments).values({ code: "DA", name: "Tạo tay trong lúc chờ" });
    await confirm(id);
    expect(await commitImport(deps, id)).toBe("INVALID");
    expect((await jobOf(id)).errors[0]!.message).toBe("Mã DA đã có trong hệ thống");
    expect((await handle.db.select().from(departments).where(eq(departments.code, "HC"))).length).toBe(0);
  });

  it("người nhập bị thu quyền trước khi xác nhận: không ghi", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const id = await upload(admin.id, [["HC", "Hành chính"]]);
    await validateImport(deps, id);
    await handle.db.delete(rolePermissions).where(eq(rolePermissions.roleId, admin.roleId));
    await confirm(id);
    expect(await commitImport(deps, id)).toBe("INVALID");
    expect((await jobOf(id)).errors[0]!.message).toBe("Bạn không còn quyền nhập dữ liệu này.");
    expect(await deptCount()).toBe(2);
  });

  it("tệp không có dòng dữ liệu: INVALID", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const id = await upload(admin.id, []);
    expect(await validateImport(deps, id)).toBe("INVALID");
    expect((await jobOf(id)).errors[0]!.message).toMatch(/không có dòng dữ liệu/);
  });
});

describe("quét yêu cầu nhập kẹt hoặc bỏ dở", () => {
  it("kẹt quá 30 phút thành FAILED; READY bỏ đó quá 7 ngày thành CANCELLED; yêu cầu mới không bị đụng", async () => {
    const admin = await makeUser(handle.db, "qt", null, ["departments.manage"]);
    const stuck = await upload(admin.id, [["HC", "Hành chính"]]);
    const abandoned = await upload(admin.id, [["DA", "Dự án"]]);
    const fresh = await upload(admin.id, [["TC", "Tài chính"]]);
    await validateImport(deps, abandoned);
    const now = Date.now();
    await handle.db
      .update(importJobs)
      .set({ updatedAt: new Date(now - 31 * 60_000) })
      .where(eq(importJobs.id, stuck));
    await handle.db
      .update(importJobs)
      .set({ updatedAt: new Date(now - 8 * 86_400_000) })
      .where(eq(importJobs.id, abandoned));
    expect(await sweepImports(deps)).toEqual({ stuck: 1, abandoned: 1 });
    expect((await jobOf(stuck)).status).toBe("FAILED");
    expect((await jobOf(abandoned)).status).toBe("CANCELLED");
    expect((await jobOf(fresh)).status).toBe("VALIDATING");
  });
});
