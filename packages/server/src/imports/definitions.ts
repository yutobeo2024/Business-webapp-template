/**
 * Kiểm và ghi cho từng loại nhập (spec 003). `validate` chạy cả lúc xem trước và lúc xác nhận (dữ liệu có thể đã đổi);
 * `commit` chạy trong transaction của nơi gọi, ném lỗi là rollback toàn bộ.
 */
import { inArray } from "drizzle-orm";
import { departments, type DbOrTx } from "@app/db";
import {
  IMPORT_MAX_ERRORS,
  IMPORT_ROW_SCHEMAS,
  IMPORT_TYPES,
  type ImportRowError,
  type ImportType,
} from "@app/shared";
import type { z } from "zod";
import type { SheetRow } from "./xlsx.js";

type Row<T extends ImportType> = z.output<(typeof IMPORT_ROW_SCHEMAS)[T]>;

export interface ValidatedRows<T extends ImportType> {
  valid: { row: number; data: Row<T> }[];
  errors: ImportRowError[];
  errorCount: number;
}

interface Definition<T extends ImportType> {
  /** Kiểm với DB (trùng mã đã có...), sau khi từng dòng đã qua schema. */
  checkAgainstDb(db: DbOrTx, rows: { row: number; data: Row<T> }[]): Promise<ImportRowError[]>;
  /** Ghi tất cả. Trả số bản ghi đã tạo. */
  commit(tx: DbOrTx, rows: Row<T>[]): Promise<number>;
}

const header = <T extends ImportType>(type: T, key: string) =>
  IMPORT_TYPES[type].columns.find((c) => c.key === key)?.header ?? key;

export const IMPORT_DEFINITIONS: { [T in ImportType]: Definition<T> } = {
  departments: {
    async checkAgainstDb(db, rows) {
      const errors: ImportRowError[] = [];
      const seen = new Map<string, number>();
      for (const r of rows) {
        const first = seen.get(r.data.code);
        if (first !== undefined) {
          errors.push({
            row: r.row,
            column: header("departments", "code"),
            message: `Mã ${r.data.code} trùng với dòng ${first}`,
          });
        } else seen.set(r.data.code, r.row);
      }
      const codes = [...seen.keys()];
      const existing = codes.length
        ? await db
            .select({ code: departments.code })
            .from(departments)
            .where(inArray(departments.code, codes))
        : [];
      for (const e of existing) {
        errors.push({
          row: seen.get(e.code)!,
          column: header("departments", "code"),
          message: `Mã ${e.code} đã có trong hệ thống`,
        });
      }
      return errors;
    },
    async commit(tx, rows) {
      if (rows.length === 0) return 0;
      const created = await tx.insert(departments).values(rows).returning({ id: departments.id });
      return created.length;
    },
  },
};

/** Kiểm schema từng dòng rồi kiểm với DB. Lỗi xếp theo dòng; chỉ giữ IMPORT_MAX_ERRORS lỗi đầu. */
export async function validateImportRows<T extends ImportType>(
  db: DbOrTx,
  type: T,
  rows: SheetRow[],
): Promise<ValidatedRows<T>> {
  const schema = IMPORT_ROW_SCHEMAS[type];
  const errors: ImportRowError[] = [];
  const valid: { row: number; data: Row<T> }[] = [];
  for (const r of rows) {
    const parsed = schema.safeParse(r.values);
    if (parsed.success) {
      valid.push({ row: r.row, data: parsed.data as Row<T> });
      continue;
    }
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      errors.push({ row: r.row, column: key ? header(type, key) : null, message: issue.message });
    }
  }
  errors.push(...(await IMPORT_DEFINITIONS[type].checkAgainstDb(db, valid)));
  errors.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const bad = new Set(errors.map((e) => e.row));
  return {
    valid: valid.filter((v) => !bad.has(v.row)),
    errors: errors.slice(0, IMPORT_MAX_ERRORS),
    errorCount: errors.length,
  };
}
