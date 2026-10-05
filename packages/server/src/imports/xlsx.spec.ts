import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildImportTemplate, readImportSheet } from "./xlsx.js";
import { checkZip } from "./zip-guard.js";

async function workbook(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Trang 1");
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("đọc tệp nhập Excel", () => {
  it("tiêu đề không phân biệt hoa thường, thứ tự tùy ý; bỏ dòng trống; công thức lấy kết quả; chữ định dạng nối lại", async () => {
    const buf = await workbook([
      ["  TÊN PHÒNG BAN ", "Ghi chú thêm", "mã phòng ban"],
      ["Phòng Kinh doanh", "x", "kd"],
      [],
      [
        { richText: [{ text: "Phòng " }, { text: "Kế toán", font: { bold: true } }] },
        "",
        { formula: '"K"&"T"', result: "KT" },
      ],
    ]);
    const r = await readImportSheet(buf, "departments", 100);
    expect(r.fileErrors).toEqual([]);
    expect(r.rows).toEqual([
      { row: 2, values: { code: "kd", name: "Phòng Kinh doanh" } },
      { row: 4, values: { code: "KT", name: "Phòng Kế toán" } },
    ]);
  });

  it("thiếu cột bắt buộc, tệp trống, quá số dòng: lỗi cả tệp, không trả dòng nào", async () => {
    const missing = await readImportSheet(await workbook([["Mã phòng ban"], ["KD"]]), "departments", 100);
    expect(missing.fileErrors[0]!.message).toMatch(/Thiếu cột: "Tên phòng ban"/);
    expect((await readImportSheet(await workbook([]), "departments", 100)).fileErrors[0]!.message).toMatch(
      /trống/,
    );
    const many = await workbook([
      ["Mã phòng ban", "Tên phòng ban"],
      ["A", "a"],
      ["B", "b"],
      ["C", "c"],
    ]);
    const over = await readImportSheet(many, "departments", 2);
    expect(over.rows).toEqual([]);
    expect(over.fileErrors[0]!.message).toMatch(/quá 2 dòng/);
  });

  it("tệp không phải xlsx: lỗi rõ ràng, không ném ngoại lệ", async () => {
    const r = await readImportSheet(Buffer.from("PK\u0003\u0004 không phải excel"), "departments", 10);
    expect(r.fileErrors[0]!.message).toMatch(/Excel/);
  });

  it("tệp mẫu đọc lại được: đúng tiêu đề, một dòng ví dụ", async () => {
    const r = await readImportSheet(await buildImportTemplate("departments"), "departments", 10);
    expect(r).toEqual({
      rows: [{ row: 2, values: { code: "KD", name: "Phòng Kinh doanh" } }],
      fileErrors: [],
    });
  });
});

/** Zip một mục nén deflate; `declared`: kích thước sau giải nén GHI trong tệp (mặc định đúng sự thật). */
function zipOne(name: string, content: Buffer, declared = content.length): Buffer {
  const data = deflateRawSync(content);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

describe("chặn zip bomb", () => {
  it("tệp Excel bình thường qua được", async () => {
    expect(checkZip(await buildImportTemplate("departments"))).toBeNull();
  });

  it("tệp nở quá trần bị chặn bằng giải nén THẬT, kể cả khi tệp khai báo kích thước nhỏ để lừa", () => {
    const limits = { maxUncompressed: 50 * 1024 * 1024, maxRatio: 1e9, maxEntries: 100 };
    const honest = zipOne("xl/worksheets/sheet1.xml", Buffer.alloc(60 * 1024 * 1024, 0x20));
    expect(honest.length).toBeLessThan(200 * 1024); // vài trăm KB nở thành 60 MB
    expect(checkZip(honest, limits)).toMatch(/quá lớn/);
    const lying = zipOne("xl/worksheets/sheet1.xml", Buffer.alloc(60 * 1024 * 1024, 0x20), 1000);
    expect(checkZip(lying, limits)).toMatch(/quá lớn/);
  });

  it("tỷ lệ nén bất thường, tệp không phải zip, dữ liệu nén hỏng: từ chối", async () => {
    const buf = await buildImportTemplate("departments");
    expect(checkZip(buf, { maxUncompressed: 1e9, maxRatio: 1, maxEntries: 100 })).toMatch(/tỷ lệ nén/);
    expect(checkZip(Buffer.from("không phải zip"))).toMatch(/không phải Excel/);
    const broken = zipOne("a.xml", Buffer.from("abc"));
    broken[30 + "a.xml".length] = 0xff; // byte đầu của dữ liệu nén
    broken[31 + "a.xml".length] = 0xff;
    expect(checkZip(broken)).toMatch(/hỏng/);
  });
});
