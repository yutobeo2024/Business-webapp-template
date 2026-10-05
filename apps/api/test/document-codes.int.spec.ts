import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "@app/db";
import { nextDocumentCode } from "@app/server";
import { openDb, resetDb } from "./helpers.js";

let handle: DbHandle;
beforeAll(() => {
  handle = openDb();
});
afterAll(() => handle.close());
beforeEach(() => resetDb(handle));

describe("mã chứng từ theo năm (nextDocumentCode)", () => {
  it("tăng liên tục trong năm, đánh lại từ 000001 khi sang năm (theo giờ Việt Nam), tiền tố độc lập", async () => {
    const dec31 = new Date("2026-12-31T16:59:00Z"); // 23:59 31/12 giờ Việt Nam
    const jan1 = new Date("2026-12-31T17:00:00Z"); // 00:00 01/01/2027 giờ Việt Nam
    expect(await nextDocumentCode(handle.db, "TU", dec31)).toBe("TU-2026-000001");
    expect(await nextDocumentCode(handle.db, "TU", dec31)).toBe("TU-2026-000002");
    expect(await nextDocumentCode(handle.db, "TU", jan1)).toBe("TU-2027-000001");
    expect(await nextDocumentCode(handle.db, "QT", dec31)).toBe("QT-2026-000001");
  });

  it("20 phiếu tạo song song: không trùng, không nhảy số", async () => {
    const codes = await Promise.all(
      Array.from({ length: 20 }, () => handle.db.transaction((tx) => nextDocumentCode(tx, "TT"))),
    );
    expect(new Set(codes).size).toBe(20);
    expect(codes.map((c) => Number(c.slice(-6))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("transaction lỗi thì số được trả lại; tiền tố sai bị từ chối", async () => {
    await handle.db
      .transaction(async (tx) => {
        await nextDocumentCode(tx, "TU");
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect((await nextDocumentCode(handle.db, "TU")).endsWith("-000001")).toBe(true);
    await expect(nextDocumentCode(handle.db, "tu-1")).rejects.toThrow(/Tiền tố/);
  });
});
