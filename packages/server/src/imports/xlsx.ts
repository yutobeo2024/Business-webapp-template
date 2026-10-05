/**
 * Đọc tệp nhập Excel có giới hạn và sinh tệp mẫu (spec 003). Chỉ đọc sheet đầu, giá trị đã lưu sẵn trong tệp (không
 * chạy công thức), mọi ô chuyển thành chuỗi đã bỏ khoảng trắng thừa; dòng trống bị bỏ qua.
 */
import ExcelJS from "exceljs";
import { IMPORT_TYPES, type ImportColumn, type ImportRowError, type ImportType } from "@app/shared";
import { checkZip, type ZipLimits } from "./zip-guard.js";

/** Tệp nhập vài nghìn dòng chỉ vài MB sau giải nén; trần thấp để tệp lạ không làm worker hết RAM. */
const IMPORT_ZIP_LIMITS: ZipLimits = { maxUncompressed: 50 * 1024 * 1024, maxRatio: 100, maxEntries: 500 };

export interface SheetRow {
  /** Số dòng trong Excel (tiêu đề là dòng 1). */
  row: number;
  values: Record<string, string>;
}

export interface ReadResult {
  rows: SheetRow[];
  /** Lỗi cả tệp (thiếu cột, quá số dòng, tệp hỏng): có lỗi này thì `rows` rỗng. */
  fileErrors: ImportRowError[];
}

const normalizeHeader = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** Giá trị ô -> chuỗi. Công thức lấy kết quả đã lưu; ngày dạng yyyy-mm-dd; ô lỗi (#N/A...) thành rỗng. */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v)
      return v.richText
        .map((r) => r.text)
        .join("")
        .trim();
    if ("formula" in v || "sharedFormula" in v)
      return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("text" in v) return String(v.text).trim();
    if ("error" in v) return "";
  }
  return String(v).normalize("NFC").trim();
}

export async function readImportSheet(buf: Buffer, type: ImportType, maxRows: number): Promise<ReadResult> {
  const fail = (message: string): ReadResult => ({
    rows: [],
    fileErrors: [{ row: null, column: null, message }],
  });
  const zipError = checkZip(buf, IMPORT_ZIP_LIMITS);
  if (zipError) return fail(zipError);

  const columns: readonly ImportColumn[] = IMPORT_TYPES[type].columns;
  // Đọc cả tệp (đã chặn kích thước giải nén ở trên). Bộ đọc dạng stream của exceljs lỗi với một số thứ tự mục trong zip.
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return fail("Không đọc được tệp Excel (.xlsx). Hãy lưu lại bằng Excel rồi thử lại.");
  }
  const sheet = wb.worksheets[0];
  if (!sheet) return fail("Tệp không có trang tính nào");

  // Chỉ các dòng có trong tệp (eachRow bỏ dòng không tồn tại, không tạo dòng mới dù ô cuối nằm ở dòng 1.000.000).
  const existing: ExcelJS.Row[] = [];
  sheet.eachRow((r) => {
    existing.push(r);
  });
  let colIndex: Map<string, number> | null = null;
  const rows: SheetRow[] = [];
  for (const r of existing) {
    const cells = (r.values as ExcelJS.CellValue[]).map(cellText);
    if (!colIndex) {
      if (cells.every((c) => c === "")) continue;
      colIndex = new Map(cells.map((h, i) => [normalizeHeader(h), i] as const).filter(([h]) => h));
      const missing = columns.filter((c) => c.required && !colIndex!.has(normalizeHeader(c.header)));
      if (missing.length) {
        return fail(
          `Thiếu cột: ${missing.map((c) => `"${c.header}"`).join(", ")}. Dòng đầu tiên phải là tiêu đề cột như tệp mẫu.`,
        );
      }
      continue;
    }
    const values = Object.fromEntries(
      columns.map((c) => [c.key, cells[colIndex!.get(normalizeHeader(c.header)) ?? -1] ?? ""]),
    );
    if (Object.values(values).every((v) => v === "")) continue;
    if (rows.length >= maxRows) {
      return fail(`Tệp có quá ${maxRows.toLocaleString("vi-VN")} dòng dữ liệu, hãy chia nhỏ`);
    }
    rows.push({ row: r.number, values });
  }
  if (!colIndex) return fail("Tệp trống: không có dòng tiêu đề");
  return { rows, fileErrors: [] };
}

/** Tệp mẫu: dòng tiêu đề, một dòng ví dụ, trang "Hướng dẫn". */
export async function buildImportTemplate(type: ImportType): Promise<Buffer> {
  const def = IMPORT_TYPES[type];
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(def.label);
  sheet.columns = def.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(18, c.header.length + 4),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(Object.fromEntries(def.columns.map((c) => [c.key, c.example])));
  const help = wb.addWorksheet("Hướng dẫn");
  help.columns = [{ width: 100 }];
  for (const line of [
    `Nhập ${def.label.toLowerCase()} từ Excel.`,
    "Giữ nguyên dòng tiêu đề ở trang đầu tiên; xóa dòng ví dụ rồi điền dữ liệu từ dòng 2.",
    `Cột bắt buộc: ${def.columns
      .filter((c) => c.required)
      .map((c) => c.header)
      .join(", ")}.`,
    "Hệ thống kiểm tra toàn bộ tệp trước; có dòng lỗi thì không nhập dòng nào.",
  ]) {
    help.addRow([line]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
