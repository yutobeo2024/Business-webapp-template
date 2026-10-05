/**
 * Xuất file của module MẪU phiếu đề nghị (xóa cùng mẫu). PostgreSQL + Chromium THẬT (spec 002). Kiểm điều quan trọng nhất: tệp xuất chỉ chứa dữ liệu người
 * yêu cầu được xem, theo quyền tại lúc chạy.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, exportJobs, files, rolePermissions, users, type DbHandle } from "@app/db";
import { LocalFileStorage } from "@app/server";
import type { CreateExportInput, Permission } from "@app/shared";
import { PdfRenderer } from "../exports/pdf.js";
import { cleanupFiles, type ExportDeps, markStuckExports, runExport } from "../exports/processor.js";
import { makeUser as fixtureUser, resetWorkerDb } from "../testing/fixture.js";
import { makePr as fixturePr } from "./fixture.js";

let handle: DbHandle;
let deps: ExportDeps;
const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), "worker-exports-")));
const pdf = new PdfRenderer(process.env.CHROMIUM_PATH);

beforeAll(() => {
  handle = createDb(process.env.DATABASE_URL!, { max: 5, appName: "worker-test" });
  deps = { db: handle.db, log: pino({ level: "silent" }), storage, pdf, ttlHours: 24, maxRows: 100 };
});
afterAll(async () => {
  await pdf.close();
  await handle.close();
});

let deptKd: string;
let deptKt: string;
const makeUser = (name: string, departmentId: string | null, permissions: Permission[]) =>
  fixtureUser(handle.db, name, departmentId, permissions);
const makePr = (requesterId: string, departmentId: string, title: string) =>
  fixturePr(handle.db, requesterId, departmentId, title);

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
  const sheet = wb.worksheets[0]!;
  const codes: string[] = [];
  sheet.eachRow((row, i) => {
    if (i > 1) codes.push(String(row.getCell(1).value));
  });
  return { job: job!, file: file!, codes, sheet };
}

const ALL_PARAMS = { sort: "code", order: "asc" } as const;

beforeEach(async () => {
  ({ deptKd, deptKt } = await resetWorkerDb(handle.db));
});

describe("xuất Excel danh sách phiếu", () => {
  it("chỉ chứa phiếu trong phạm vi xem của người yêu cầu; đúng bộ lọc; định dạng tiền và trạng thái", async () => {
    const staffKd = await makeUser("nv-kd", deptKd, ["pr.create"]);
    const staffKt = await makeUser("nv-kt", deptKt, ["pr.create"]);
    const manager = await makeUser("tp-kd", deptKd, ["pr.view.department", "pr.export"]);
    const a = await makePr(staffKd.id, deptKd, "Phiếu KD 1");
    const b = await makePr(staffKd.id, deptKd, "Phiếu KD 2");
    await makePr(staffKt.id, deptKt, "Phiếu KT");

    const id = await requestExport(manager.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    expect(await runExport(deps, id)).toBe("done");
    const { job, file, codes, sheet } = await readXlsx(id);
    expect(codes).toEqual([a.code, b.code]);
    expect(job.status).toBe("DONE");
    expect(job.rowCount).toBe(2);
    expect(job.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(file.entityType).toBe("export_job");
    expect(file.uploadedBy).toBe(manager.id);
    expect(file.originalName).toMatch(/^phieu-de-nghi-\d{8}-\d{4}\.xlsx$/);
    expect(sheet.getRow(1).getCell(1).value).toBe("Mã phiếu");
    expect(sheet.getRow(2).getCell(4).value).toBe("Nháp");
    expect(sheet.getRow(2).getCell(5).value).toBe(180_000);

    const filtered = await requestExport(manager.id, {
      type: "purchase-requests.xlsx",
      params: { ...ALL_PARAMS, q: "KD 2" },
    });
    await runExport(deps, filtered);
    expect((await readXlsx(filtered)).codes).toEqual([b.code]);
  });

  it("người yêu cầu bị thu quyền xuất hoặc bị khóa sau khi bấm: FAILED, không có tệp", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create"]);
    await makePr(staff.id, deptKd, "Phiếu");
    const manager = await makeUser("tp", deptKd, ["pr.view.department", "pr.export"]);

    const revoked = await requestExport(manager.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    await handle.db.delete(rolePermissions).where(eq(rolePermissions.permission, "pr.export"));
    expect(await runExport(deps, revoked)).toBe("failed");

    await handle.db.insert(rolePermissions).values({ roleId: manager.roleId, permission: "pr.export" });
    const locked = await requestExport(manager.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    await handle.db.update(users).set({ isActive: false }).where(eq(users.id, manager.id));
    expect(await runExport(deps, locked)).toBe("failed");

    const rows = await handle.db.select().from(exportJobs);
    expect(rows.map((r) => [r.status, r.fileId])).toEqual([
      ["FAILED", null],
      ["FAILED", null],
    ]);
    expect(rows.map((r) => r.error)).toEqual(
      expect.arrayContaining(["Bạn không còn quyền xuất dữ liệu này.", "Tài khoản yêu cầu xuất đã bị khóa."]),
    );
    expect(await handle.db.select().from(files)).toHaveLength(0);
  });

  it("vượt EXPORT_MAX_ROWS: FAILED với hướng dẫn lọc bớt", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create", "pr.export"]);
    for (let i = 0; i < 3; i++) await makePr(staff.id, deptKd, `P${i}`);
    const id = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    expect(await runExport({ ...deps, maxRows: 2 }, id)).toBe("failed");
    const [row] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, id));
    expect(row!.error).toMatch(/vượt giới hạn 2 dòng.*lọc bớt/);
  });

  it("chạy lại yêu cầu đã DONE: bỏ qua, không tạo tệp mới (job retry an toàn)", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create", "pr.export"]);
    await makePr(staff.id, deptKd, "Phiếu");
    const id = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    expect(await runExport(deps, id)).toBe("done");
    expect(await runExport(deps, id)).toBe("skipped");
    expect(await handle.db.select().from(files)).toHaveLength(1);
  });
});

describe("in PDF phiếu", () => {
  it("tạo PDF A4 cho phiếu người yêu cầu xem được", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create"]);
    const pr = await makePr(staff.id, deptKd, "Mua giấy in <khẩn>");
    const id = await requestExport(staff.id, { type: "purchase-request.pdf", params: { id: pr.id } });
    expect(await runExport(deps, id)).toBe("done");
    const [job] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, id));
    const [file] = await handle.db.select().from(files).where(eq(files.id, job!.fileId!));
    expect(file!.mimeType).toBe("application/pdf");
    expect(file!.originalName).toBe(`${pr.code}.pdf`);
    const chunks: Buffer[] = [];
    for await (const c of await storage.open(file!.storageKey)) chunks.push(c as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5_000);
  });

  it("phiếu ngoài phạm vi xem (người khác lập, không có quyền xem phòng ban): FAILED", async () => {
    const owner = await makeUser("nv1", deptKd, ["pr.create"]);
    const other = await makeUser("nv2", deptKd, ["pr.create"]);
    const pr = await makePr(owner.id, deptKd, "Phiếu của nv1");
    const id = await requestExport(other.id, { type: "purchase-request.pdf", params: { id: pr.id } });
    expect(await runExport(deps, id)).toBe("failed");
  });
});

describe("trạng thái", () => {
  it("yêu cầu đã bị API đánh dấu lỗi (không xếp được hàng): worker không chạy, giữ nguyên FAILED", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create", "pr.export"]);
    const id = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    await handle.db.update(exportJobs).set({ status: "FAILED", error: "x" }).where(eq(exportJobs.id, id));
    expect(await runExport(deps, id)).toBe("skipped");
    const [row] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, id));
    expect(row!.status).toBe("FAILED");
    expect(await handle.db.select().from(files)).toHaveLength(0);
  });
});

describe("dọn dẹp", () => {
  it("xóa tệp xuất hết hạn và đính kèm đã xóa mềm quá 7 ngày; giữ tệp còn hạn; đánh dấu yêu cầu kẹt", async () => {
    const staff = await makeUser("nv", deptKd, ["pr.create", "pr.export"]);
    await makePr(staff.id, deptKd, "Phiếu");
    const expired = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    const fresh = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    await runExport(deps, expired);
    await runExport(deps, fresh);
    await handle.db
      .update(exportJobs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(exportJobs.id, expired));
    const expiredKey = (await readXlsx(expired)).file.storageKey;
    const freshKey = (await readXlsx(fresh)).file.storageKey;
    const stuck = await requestExport(staff.id, { type: "purchase-requests.xlsx", params: ALL_PARAMS });
    await handle.db
      .update(exportJobs)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(exportJobs.id, stuck));

    expect(await cleanupFiles(deps)).toEqual({ removed: 1 });
    expect(await markStuckExports(deps)).toBe(1);
    expect(await storage.exists(expiredKey)).toBe(false);
    expect(await storage.exists(freshKey)).toBe(true);
    const [e] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, expired));
    expect(e!.fileId).toBeNull();
    const [s] = await handle.db.select().from(exportJobs).where(eq(exportJobs.id, stuck));
    expect(s!.status).toBe("FAILED");
  });
});
