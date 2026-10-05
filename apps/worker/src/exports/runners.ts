/**
 * Mỗi loại xuất trong EXPORT_TYPES có một runner. Dữ liệu LUÔN lấy qua truy vấn dùng chung với màn hình (@app/server),
 * với quyền hiện tại của người yêu cầu: xuất không bao giờ rộng hơn thứ người đó xem được trên giao diện.
 */
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import type { Db, DbOrTx } from "@app/db";
import { listUsers } from "@app/server";
import {
  BUSINESS_TIMEZONE,
  type CurrentUser,
  type ExportParams,
  type ExportType,
  USER_STATUS_LABELS,
} from "@app/shared";
import type { PdfRenderer } from "./pdf.js";
// sample:begin
import { eq } from "drizzle-orm";
import { departments } from "@app/db";
import { findViewablePurchaseRequest, listPurchaseRequests } from "@app/server";
import { PR_STATUS_LABELS } from "@app/shared";
import { purchaseRequestHtml } from "./templates/purchase-request.js";
// sample:end

/** Lỗi người dùng hiểu và tự xử lý được (lọc bớt, mất quyền...): ghi FAILED kèm câu này, không thử lại. */
export class ExportUserError extends Error {}

export interface ExportResult {
  buffer: Buffer;
  fileName: string;
  rowCount: number;
}

export interface RunnerContext {
  db: Db;
  actor: Pick<CurrentUser, "id" | "departmentId" | "permissions">;
  pdf: PdfRenderer;
  maxRows: number;
  now: Date;
}

type Runner<T extends ExportType> = (params: ExportParams<T>, ctx: RunnerContext) => Promise<ExportResult>;

/** "20261003-0930" theo giờ Việt Nam, để tên tệp sắp xếp được. */
export function stamp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

/**
 * Excel không có múi giờ: ô ngày giờ hiển thị đúng như giá trị ghi vào. Ghi "giờ treo tường" Việt Nam (UTC+7, không có
 * giờ mùa hè) để người dùng thấy đúng giờ như trên giao diện.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const vnWallClock = (d: Date): Date => new Date(d.getTime() + VN_OFFSET_MS);

export const PAGE_SIZE = 1000;

/** Báo vượt giới hạn dòng (không cắt ngầm). */
export function assertWithinLimit(total: number, ctx: RunnerContext, noun: string): void {
  if (total > ctx.maxRows) {
    throw new ExportUserError(
      `Có ${total.toLocaleString("vi-VN")} ${noun}, vượt giới hạn ${ctx.maxRows.toLocaleString("vi-VN")} dòng mỗi lần xuất. Hãy lọc bớt rồi xuất lại.`,
    );
  }
}

/**
 * Ghi một sheet Excel dạng stream: tiêu đề in đậm, đóng băng dòng đầu, có lọc. `fill` gọi `add(row)` cho từng dòng.
 * Dữ liệu đọc trong một snapshot `repeatable read` để các trang nhất quán (dữ liệu đổi trong lúc xuất không trùng/sót).
 */
export async function writeXlsx(
  ctx: RunnerContext,
  sheetName: string,
  columns: Partial<ExcelJS.Column>[],
  fill: (tx: DbOrTx, add: (row: Record<string, unknown>) => void) => Promise<void>,
): Promise<{ buffer: Buffer; rowCount: number }> {
  return ctx.db.transaction(
    async (tx) => {
      const out = new PassThrough();
      const chunks: Buffer[] = [];
      out.on("data", (c: Buffer) => chunks.push(c));
      const done = new Promise<void>((resolve, reject) => {
        out.on("end", resolve);
        out.on("error", reject);
      });
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
      const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
      sheet.columns = columns;
      sheet.getRow(1).font = { bold: true };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      let rowCount = 0;
      await fill(tx, (row) => {
        sheet.addRow(row).commit();
        rowCount++;
      });
      sheet.commit();
      await workbook.commit();
      await done;
      return { buffer: Buffer.concat(chunks), rowCount };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * Lõi: danh sách người dùng theo bộ lọc của màn quản trị (quyền users.manage đã kiểm ở processor). Cùng cột với màn danh
 * sách; KHÔNG xuất số điện thoại (dữ liệu cá nhân chỉ dùng cho Zalo, spec 003).
 */
const usersXlsx: Runner<"admin.users.xlsx"> = async (params, ctx) => {
  const { buffer, rowCount } = await writeXlsx(
    ctx,
    "Người dùng",
    [
      { header: "Họ tên", key: "fullName", width: 28 },
      { header: "Email", key: "email", width: 32 },
      { header: "Phòng ban", key: "department", width: 26 },
      { header: "Vai trò", key: "roles", width: 36 },
      { header: "Trạng thái", key: "status", width: 18 },
      { header: "Ngày tạo", key: "createdAt", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    ],
    async (tx, add) => {
      const query = { ...params, page: 1, pageSize: PAGE_SIZE };
      let page = await listUsers(tx, query, ctx.now);
      assertWithinLimit(page.total, ctx, "người dùng");
      for (;;) {
        for (const { user, departmentName, roles } of page.items) {
          const locked = user.lockedUntil && user.lockedUntil > ctx.now;
          add({
            fullName: user.fullName,
            email: user.email,
            department: departmentName ?? "",
            roles: roles.map((r) => r.name).join(", "),
            status: USER_STATUS_LABELS[!user.isActive ? "inactive" : locked ? "locked" : "active"],
            createdAt: vnWallClock(user.createdAt),
          });
        }
        if (page.page * PAGE_SIZE >= page.total || page.items.length === 0) break;
        page = await listUsers(tx, { ...query, page: page.page + 1 }, ctx.now);
      }
    },
  );
  return { buffer, fileName: `nguoi-dung-${stamp(ctx.now)}.xlsx`, rowCount };
};

// sample:begin
const purchaseRequestsXlsx: Runner<"purchase-requests.xlsx"> = async (params, ctx) => {
  const { buffer, rowCount } = await writeXlsx(
    ctx,
    "Phiếu đề nghị",
    [
      { header: "Mã phiếu", key: "code", width: 18 },
      { header: "Tiêu đề", key: "title", width: 40 },
      { header: "Người lập", key: "requester", width: 24 },
      { header: "Trạng thái", key: "status", width: 22 },
      { header: "Tổng tiền (VND)", key: "total", width: 18, style: { numFmt: "#,##0" } },
      { header: "Ngày lập", key: "createdAt", width: 18, style: { numFmt: "dd/mm/yyyy hh:mm" } },
      { header: "Lý do từ chối", key: "rejectReason", width: 40 },
    ],
    async (tx, add) => {
      const query = { ...params, page: 1, pageSize: PAGE_SIZE };
      let page = await listPurchaseRequests(tx, ctx.actor, query);
      assertWithinLimit(page.total, ctx, "phiếu");
      for (;;) {
        for (const { pr, requesterName } of page.items) {
          add({
            code: pr.code,
            title: pr.title,
            requester: requesterName,
            status: PR_STATUS_LABELS[pr.status],
            total: pr.totalAmount,
            createdAt: vnWallClock(pr.createdAt),
            rejectReason: pr.rejectReason ?? "",
          });
        }
        if (page.page * PAGE_SIZE >= page.total || page.items.length === 0) break;
        page = await listPurchaseRequests(tx, ctx.actor, { ...query, page: page.page + 1 });
      }
    },
  );
  return { buffer, fileName: `phieu-de-nghi-${stamp(ctx.now)}.xlsx`, rowCount };
};

const purchaseRequestPdf: Runner<"purchase-request.pdf"> = async (params, ctx) => {
  const found = await findViewablePurchaseRequest(ctx.db, ctx.actor, params.id);
  if (!found) throw new ExportUserError("Phiếu không còn tồn tại hoặc bạn không còn quyền xem phiếu này.");
  const [dept] = await ctx.db
    .select({ name: departments.name })
    .from(departments)
    .where(eq(departments.id, found.pr.departmentId));
  const buffer = await ctx.pdf.render(
    purchaseRequestHtml({
      pr: found.pr,
      requesterName: found.requesterName,
      departmentName: dept?.name ?? "",
      printedAt: ctx.now,
    }),
  );
  return { buffer, fileName: `${found.pr.code}.pdf`, rowCount: 1 };
};
// sample:end

/** Thiếu runner cho một loại trong EXPORT_TYPES: typecheck báo lỗi. */
const RUNNERS: { [T in ExportType]: Runner<T> } = {
  "admin.users.xlsx": usersXlsx,
  // sample:begin
  "purchase-requests.xlsx": purchaseRequestsXlsx,
  "purchase-request.pdf": purchaseRequestPdf,
  // sample:end
};

export function runExportType<T extends ExportType>(
  input: { type: T; params: ExportParams<T> },
  ctx: RunnerContext,
): Promise<ExportResult> {
  return RUNNERS[input.type](input.params, ctx);
}
